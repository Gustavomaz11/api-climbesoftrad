import { ConfigService } from '@nestjs/config'
import { createHash,randomBytes } from 'node:crypto'
import request from 'supertest'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import type { PhysicianEntity } from '../src/database/entities/physician.entity'
import { standardModalities } from '../src/modules/exam-modalities/standard-modalities'
import { WorkflowStoreService } from '../src/modules/exam-workflow/workflow-store.service'
import type { CompanyAccessContext } from '../src/modules/companies/company-context.contracts'

describe('Software configuration and CRM registration (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let external: jest.SpiedFunction<typeof fetch>
  const doctor = { nomeEntidade:'MEDICO INTEGRACAO',crm:'4951/SE',uf:'SE',situacao:'Transferido',
    inscricaoOutrosEstados:'SP/180533 (Regular)',especialidades:['Radiologia e Diagnóstico por Imagem','Ultrassonografia'],
    endereco:'DO NOT STORE',telefone:'DO NOT STORE' }
  const provider = (medicos = [doctor]) => external.mockResolvedValueOnce(new Response(JSON.stringify({metaDados:{resultadoId:1,TOKEN:'test-secret'},retorno:{medicos}}),{status:200}))
  const lookup = async () => {
    provider()
    return responseBody<{lookupId:string;enabledStates:string[]}>(await f.api('post','/physicians/registry-lookup').send({crm:'4951',uf:'SE'}).expect(201))
  }
  beforeAll(async()=>{
    f=await createOperationalDocumentsFixture()
    f.app.get(ConfigService).set('DIRECTD_CFM_TOKEN','test-secret')
    external=jest.spyOn(globalThis,'fetch')
  },30000)
  afterAll(async()=>{external?.mockRestore();await f?.app.close()})

  it('validates CRM/UF before calling the provider and strips private provider fields',async()=>{
    await f.api('post','/physicians/registry-lookup').send({crm:'4951',uf:'XX'}).expect(400)
    expect(external).not.toHaveBeenCalled()
    const result=await lookup()
    expect(result.enabledStates).toEqual(['SP'])
    expect(JSON.stringify(result)).not.toContain('test-secret')
    expect(JSON.stringify(result)).not.toContain('DO NOT STORE')
  })
  it('persists lookup data, optional contact and all units by default',async()=>{
    const result=await lookup()
    const saved=responseBody<PhysicianEntity & {allUnits:boolean;enabledStates:string[]}>(await f.api('post','/physicians').send({ email: 'doctor-4951se@integration.test',name:'Override attempt',crm:'4951/SE',registryLookupId:result.lookupId,contactPhone:'(79) 99999-0000'}).expect(201))
    expect(saved.name).toBe(doctor.nomeEntidade)
    expect(saved.allUnits).toBe(true)
    expect(saved.enabledStates).toEqual(['SP'])
    expect(saved.registryProfile?.specialties).toEqual(doctor.especialidades)
    expect(saved.contactPhone).toBe('(79) 99999-0000')
    await f.api('post','/physicians').send({ email: 'doctor-4951se@integration.test',name:'Replay',crm:'4951/SE',registryLookupId:result.lookupId}).expect(400)
  })
  it('rejects expired, foreign-company and mismatched CRM lookups',async()=>{
    const result=await lookup()
    await f.api('post','/physicians').send({ email: 'doctor-123sp@integration.test',name:'Mismatch',crm:'123/SP',registryLookupId:result.lookupId}).expect(400)
    const other=responseBody<{id:string}>(await f.api('post','/companies').send({name:'Empresa configuração teste'}).expect(201)).id
    await f.api('post','/physicians',other).send({ email: 'doctor-4951se@integration.test',name:'Foreign',crm:'4951/SE',registryLookupId:result.lookupId}).expect(400)
    await f.database.query(`UPDATE physician_registry_lookups SET expires_at=now()-interval '1 minute' WHERE id=$1`,[result.lookupId])
    await f.api('post','/physicians').send({ email: 'doctor-4951se@integration.test',name:'Expired',crm:'4951/SE',registryLookupId:result.lookupId}).expect(400)
  })
  it('does not duplicate a doctor registered under another state',async()=>{
    provider([{...doctor,crm:'180533/SP',uf:'SP',situacao:'Regular',inscricaoOutrosEstados:'SE/4951 (Transferido)'}])
    const result=responseBody<{lookupId:string}>(await f.api('post','/physicians/registry-lookup').send({crm:'180533',uf:'SP'}).expect(201))
    await f.api('post','/physicians').send({ email: 'doctor-180533sp@integration.test',name:doctor.nomeEntidade,crm:'180533/SP',registryLookupId:result.lookupId}).expect(409)
    const [resultCount]=await f.database.query<Array<{count:string}>>('SELECT count(*) FROM physicians WHERE name=$1',[doctor.nomeEntidade])
    expect(resultCount?.count).toBe('1')
  })
  it('sanitizes provider failures and reports empty results',async()=>{
    external.mockRejectedValueOnce(new Error('https://provider/?TOKEN=test-secret'))
    const failed=await f.api('post','/physicians/registry-lookup').send({crm:'4951',uf:'SE'}).expect(502)
    expect(JSON.stringify(failed.body)).not.toContain('test-secret')
    provider([])
    await f.api('post','/physicians/registry-lookup').send({crm:'4951',uf:'SE'}).expect(400)
  })
  it('binds a newly registered doctor only to the hospitals selected by the administrator',async()=>{
    provider([{...doctor,nomeEntidade:'OUTRO MEDICO',crm:'6060/SP',uf:'SP',situacao:'Regular',inscricaoOutrosEstados:''}])
    const registry=responseBody<{lookupId:string}>(await f.api('post','/physicians/registry-lookup').send({crm:'6060',uf:'SP'}).expect(201))
    const saved=responseBody<{allUnits:boolean;unitIds:string[];initialPassword:string;mustChangePassword:boolean}>(await f.api('post','/physicians').send({ email: 'doctor-6060sp@integration.test',name:'OUTRO MEDICO',crm:'6060/SP',registryLookupId:registry.lookupId,allUnits:false,unitIds:[f.unit]}).expect(201))
    expect(saved.allUnits).toBe(false)
    expect(saved.unitIds).toEqual([f.unit])
    expect(saved.initialPassword).toBe('6060SP')
    expect(saved.mustChangePassword).toBe(true)
  })
  it('requires the CRM+UF initial password to be changed before accessing clinical features',async()=>{
    const login=async(password:string)=>{
      const verifier=randomBytes(64).toString('base64url')
      const response=await request(f.server).post('/api/v1/auth/login').send({email:'6060/SP',password,clientId:'crm-web',remember:false,
        codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',state:randomBytes(32).toString('base64url')})
      return {response,verifier}
    }
    const first=await login('6060SP')
    expect(first.response.status).toBe(200)
    const exchange=await request(f.server).post('/api/v1/auth/token').set('Origin','http://localhost:5173').set('X-Requested-With','XMLHttpRequest')
      .send({grantType:'authorization_code',clientId:'crm-web',authorizationCode:responseBody<{authorizationCode:string}>(first.response).authorizationCode,codeVerifier:first.verifier}).expect(200)
    const bearer='Bearer '+responseBody<{accessToken:string}>(exchange).accessToken
    await request(f.server).get('/api/v1/exams').set('Authorization',bearer).expect(403)
    const changed=await request(f.server).put('/api/v1/auth/password').set('Authorization',bearer)
      .send({currentPassword:'6060SP',newPassword:'NovaSenhaMedica2026!'}).expect(200)
    expect(responseBody<{mustChangePassword:boolean}>(changed).mustChangePassword).toBe(false)
    expect(responseBody<{mustUploadSignature:boolean}>(changed).mustUploadSignature).toBe(true)
    await request(f.server).get('/api/v1/exams').set('Authorization',bearer).expect(403)
    expect((await login('6060SP')).response.status).toBe(401)
    expect((await login('NovaSenhaMedica2026!')).response.status).toBe(200)
  })
  it('seeds all standard modalities, supports custom codes, edits and tenant isolation',async()=>{
    type Modality={code:string;name:string;active:boolean}
    const items=responseBody<Modality[]>(await f.api('get','/exam-modalities').expect(200))
    expect(items).toHaveLength(standardModalities.length)
    expect(items.some(item=>item.code==='PT')).toBe(true)
    await f.api('post','/exam-modalities').set('X-Unit-Id',f.unit).send({code:'SCOPED',name:'Alteração fora do escopo',active:true}).expect(403)
    await f.api('post','/exam-modalities').send({code:'CUSTOM',name:'Modalidade teste',active:true}).expect(201)
    const updated=responseBody<Modality>(await f.api('put','/exam-modalities/CUSTOM').send({code:'CUSTOM',name:'Nome atualizado',active:false}).expect(200))
    expect(updated).toMatchObject({code:'CUSTOM',name:'Nome atualizado',active:false})
    await f.api('post','/exam-catalog/types').send({name:'Tipo inativo',modality:'CUSTOM',groupName:'Teste',active:true}).expect(400)
    await f.api('post','/exam-modalities').send({code:'CUSTOM',name:'Duplicado',active:true}).expect(409)
    const other=responseBody<{id:string}>(await f.api('post','/companies').send({name:'Modalidades outra empresa'}).expect(201)).id
    const foreign=responseBody<Modality[]>(await f.api('get','/exam-modalities',other).expect(200))
    expect(foreign.some(item=>item.code==='CUSTOM')).toBe(false)
    const exam=await f.exam({modality:'PT'})
    expect(exam.id).toBeDefined()
    await f.api('post','/exam-catalog/types').send({name:'Modalidade inexistente',modality:'UNDEFINED',groupName:'Teste',active:true}).expect(400)
  })
  it('saves unit UF and enforces regular-state qualification',async()=>{
    await f.api('put',`/hospital-units/${f.unit}`).send({name:'Unidade SP',uf:'SP'}).expect(200)
    await f.api('put',`/hospital-units/${f.secondUnit}`).send({name:'Unidade SE',uf:'SE'}).expect(200)
    const physicians=responseBody<Array<{id:string;name:string}>>(await f.api('get','/physicians').expect(200))
    const physician=physicians.find(item=>item.name===doctor.nomeEntidade)!
    const type=responseBody<{id:string}>(await f.api('post','/exam-catalog/types').send({name:'TC configuração',modality:'CT',groupName:'Teste',active:true}).expect(201))
    await f.api('post',`/physicians/${physician.id}/qualifications`).send({unitId:f.secondUnit,examTypeId:type.id,reason:'Teste de inscrição transferida'}).expect(400)
    await f.api('post',`/physicians/${physician.id}/qualifications`).send({unitId:f.unit,examTypeId:type.id,reason:'Teste de inscrição regular'}).expect(201)
    await f.api('post','/physicians').send({ email: 'doctor-testrestricted@integration.test',name:'Restrito teste',crm:'TEST-RESTRICTED',allUnits:false,unitIds:[]}).expect(400)
    expect(initialCompanyId).toBeDefined()
  })
  it('blocks clinical writes in an unlicensed unit state and allows an additional regular state',async()=>{
    const [physician]=await f.database.query<Array<{user_id:string}>>('SELECT user_id FROM physicians WHERE name=$1',[doctor.nomeEntidade])
    const context: CompanyAccessContext = {
      userId:physician!.user_id,companyId:initialCompanyId,companyName:'Teste',allUnits:true,unitIds:[],role:'DOCTOR',
      membershipId:null,selectedUnitId:null,isPlatformAdmin:false,correlationId:'test',sessionId:'test',
      accessRoleId:'test',accessRoleName:'DOCTOR',mustChangePassword:false,permissions:['reports.edit'],
    }
    const sp=await f.exam({unitId:f.unit}),se=await f.exam({unitId:f.secondUnit})
    const workflow=f.app.get(WorkflowStoreService)
    await expect(workflow.writable(sp.id,context,()=>Promise.resolve('allowed'))).resolves.toBe('allowed')
    await expect(workflow.writable(se.id,context,()=>Promise.resolve('forbidden'))).rejects.toThrow('inscrição regular')
  })
})
