import { normalizeRegistryDoctor, registryAllowsState, registeredCrmForState } from './physician-registry.policy'
const doctor = { nomeEntidade: 'MEDICO TESTE', crm: '4951/SE', uf: 'SE', situacao: 'Transferido',
  inscricaoOutrosEstados: 'SP/180533 (Regular); BA/123 (Cancelado); ZZ/1 (Regular)', especialidades: ['Radiologia e Diagnóstico por Imagem'] }
describe('CRM registry normalization', () => {
  it('enables regular additional states without enabling a transferred primary registration', () => {
    const profile = normalizeRegistryDoctor(doctor,'4951','SE')
    expect(profile.registrations).toHaveLength(3)
    expect(registryAllowsState(profile,'SP')).toBe(true)
    expect(registryAllowsState(profile,'SE')).toBe(false)
    expect(registryAllowsState(profile,'BA')).toBe(false)
    expect(profile.specialties).toEqual(doctor.especialidades)
    expect(registeredCrmForState(profile,'SP','4951/SE')).toBe('180533/SP')
    expect(()=>registeredCrmForState(profile,'SE','4951/SE')).toThrow()
  })
  it('does not infer authorization from unknown status or unstructured text', () => {
    const profile = normalizeRegistryDoctor({...doctor,situacao:'Não regular',inscricaoOutrosEstados:'SP/180533; RJ (Suspenso)'},'4951','SE')
    expect(registryAllowsState(profile)).toBe(false)
    expect(registryAllowsState(null,'SP')).toBe(true) // legacy records keep their existing qualification policy
  })
  it('rejects another physician returned by the provider', () => {
    expect(()=>normalizeRegistryDoctor({...doctor,crm:'99/SE'},'4951','SE')).toThrow()
    expect(()=>normalizeRegistryDoctor({...doctor,uf:'SP'},'4951','SE')).toThrow()
  })
  it('excludes provider contact/address and preserves all specialties', () => {
    const profile = normalizeRegistryDoctor({...doctor,endereco:'PRIVATE',telefone:'PRIVATE',especialidades:['Cardiologia','Clínica Médica']},'4951','SE')
    expect(JSON.stringify(profile)).not.toContain('PRIVATE')
    expect(profile.specialties).toHaveLength(2)
  })
})
