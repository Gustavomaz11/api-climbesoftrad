// Reconcile a legacy hospital-company draft into a hospital unit of SouRad.
// Dry run by default. Stop its folder agent and back up the DB before --apply.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import pg from 'pg'

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key,...value]=arg.replace(/^--/,'').split('='); return [key,value.join('=') || true]
}))
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
if (![args['source-company'],args['source-unit'],args['target-unit']].every(uuid) || typeof args['agent-config']!=='string')
  throw new Error('Specify --source-company, --source-unit, --target-unit and --agent-config')
const env=parse(await readFile('.env','utf8'))
const central=env.SOURAD_CENTRAL_COMPANY_ID || '00000000-0000-4000-8000-000000000001'
if (args['source-company']===central) throw new Error('The source must be a legacy hospital company')
const configPath=resolve(args['agent-config']), original=await readFile(configPath,'utf8'), config=JSON.parse(original)
const client=new pg.Client({connectionString:env.DATABASE_URL})
await client.connect()
try {
  const {rows:[target]}=await client.query('SELECT id FROM hospital_units WHERE id=$1 AND company_id=$2 AND active=true',[args['target-unit'],central])
  if (!target) throw new Error('Active hospital unit in central workspace required')
  const {rows:[source]}=await client.query(`SELECT * FROM dicom_sources WHERE company_id=$1 AND unit_id=$2 AND active=true AND token_hash=$3`,
    [args['source-company'],args['source-unit'],createHash('sha256').update(config.token).digest('hex')])
  if (!source || config.unitId!==args['source-unit']) throw new Error('Agent config must match the active source being consolidated')
  const {rows:[usage]}=await client.query(`SELECT
    (SELECT count(*)::int FROM exams WHERE company_id=$1) AS exams,
    (SELECT count(*)::int FROM company_memberships WHERE company_id=$1) AS memberships,
    (SELECT count(*)::int FROM upload_sessions WHERE company_id=$1 AND (source_id<>$2 OR status<>'AWAITING_REVIEW' OR exam_id IS NOT NULL OR intake_id IS NULL)) AS unexpected_uploads`,[args['source-company'],source.id])
  if (usage.exams || usage.memberships || usage.unexpected_uploads) throw new Error('Legacy company has other records: prepare a separate migration for those records')
  const {rows:drafts}=await client.query(`SELECT * FROM hospital_intakes WHERE company_id=$1 AND unit_id=$2 FOR UPDATE`,[args['source-company'],args['source-unit']])
  if (!drafts.length || drafts.some(draft=>draft.status!=='DRAFT' || draft.exam_id)) throw new Error('Only unsent hospital drafts can be consolidated')
  const {rows:[count]}=await client.query('SELECT count(*)::int AS uploads FROM upload_sessions WHERE company_id=$1',[args['source-company']])
  console.log(JSON.stringify({dryRun:!args.apply,drafts:drafts.length,uploads:count.uploads,centralUnit:target.id,preservesDraft:true,preservesStorageKeys:true}))
  if (!args.apply) process.exitCode=0
  else {
    const token=randomBytes(32).toString('base64url'),sourceId=randomUUID(),stamp=new Date().toISOString().replace(/[:.]/g,'-')
    const recoveryPath=join(dirname(configPath),`config.central-prepared-${stamp}.json`)
    await writeFile(join(dirname(configPath),`config.before-central-${stamp}.json`),original,{mode:0o600})
    const next={...config,unitId:target.id,token}
    await writeFile(recoveryPath,JSON.stringify(next,null,2)+'\n',{mode:0o600})
    await client.query('BEGIN')
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`consolidate:${source.id}`])
      await client.query('INSERT INTO dicom_sources(id,company_id,unit_id,name,token_hash,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)',
        [sourceId,central,target.id,source.name,createHash('sha256').update(token).digest('hex'),source.created_by_user_id])
      for (const draft of drafts) {
        const id=randomUUID()
        await client.query(`INSERT INTO hospital_intakes(id,company_id,unit_id,study_uid,identity_hash,status,version,fields,issues,created_at)
          VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9)`,[id,central,target.id,draft.study_uid,draft.identity_hash,draft.version+1,draft.fields,JSON.stringify(draft.issues),draft.created_at])
        await client.query(`UPDATE upload_sessions SET company_id=$2::uuid,unit_id=$3::uuid,intake_id=$4::uuid,source_id=$5::uuid,
          context=context || jsonb_build_object('companyId',$2::uuid::text,'unitIds',jsonb_build_array($3::uuid::text),'selectedUnitId',$3::uuid::text,'integrationSourceId',$5::uuid::text,'allUnits',false)
          WHERE intake_id=$1::uuid AND company_id=$6::uuid AND status='AWAITING_REVIEW'`,[draft.id,central,target.id,id,sourceId,args['source-company']])
        await client.query('UPDATE dicom_viewer_grants SET expires_at=now() WHERE intake_id=$1',[draft.id])
        await client.query(`INSERT INTO operational_events(company_id,unit_id,actor_user_id,correlation_id,action,resource_type,resource_id,reason,metadata)
          VALUES($1,$2,$3,$4,'HOSPITAL_INTAKE_REASSIGNED','hospital-intake',$5,$6,$7)`,
        [central,target.id,source.created_by_user_id,randomUUID(),id,'Hospital is an origin unit of the SouRad central workspace',
          {previousIntakeId:draft.id,previousCompanyId:args['source-company'],previousUnitId:args['source-unit'],draftPreserved:true}])
      }
      await client.query('UPDATE dicom_sources SET active=false WHERE company_id=$1',[args['source-company']])
      await client.query('UPDATE hospital_referral_routes SET active=false WHERE company_id=$1',[args['source-company']])
      await client.query('UPDATE companies SET active=false WHERE id=$1',[args['source-company']])
      await client.query('COMMIT')
    } catch(error) { await client.query('ROLLBACK');throw error }
    await writeFile(configPath,JSON.stringify(next,null,2)+'\n',{mode:0o600})
    console.log(JSON.stringify({consolidated:true,sourceId,centralUnit:target.id,agentConfigUpdated:true,recoveryConfig:recoveryPath}))
  }
} finally { await client.end() }
