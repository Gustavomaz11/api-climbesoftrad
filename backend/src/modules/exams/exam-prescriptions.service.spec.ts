import type { Repository } from 'typeorm'
import type { AuthUserEntity } from '../../database/entities/auth-user.entity'
import type { ExamEntity } from '../../database/entities/exam.entity'
import type { MedicalSpecialtyEntity } from '../../database/entities/medical-specialty.entity'
import type { PhysicianEntity } from '../../database/entities/physician.entity'
import { companyTestContext as context } from '../../../test/company-test-context'
import type { ExamAccessService } from './exam-access.service'
import type { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyPresentationService } from '../companies/company-presentation.service'
import { ForbiddenException } from '@nestjs/common'
import { ExamPrescriptionsService } from './exam-prescriptions.service'
import type { R2ObjectStorage } from './r2-object-storage.service'
import type { PrescriptionProtocolsService } from '../contrast-protocols/prescription-protocols.service'
import type { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

const exam = {
  id: '7fb1e38b-685d-4cb2-9dc6-24ab39808267',
  companyId: context.companyId,
  unitId: context.unitIds[0],
  unit: { name: 'Hospital A' },
  patientName: 'Maria dos Santos',
  studyDescription: 'Ressonância magnética do joelho',
  performedAt: new Date('2026-08-23T15:04:00.000Z'),
  modality: 'MR',
} as ExamEntity

const doctor = {
  id: '17dba5fb-2bde-4745-a9c5-cb72deccf8f1',
  fullName: 'Dra. Ana Oliveira',
  role: 'DOCTOR',
  status: 'ACTIVE',
} as AuthUserEntity

const physician = {
  userId: doctor.id,
  name: 'Dra. Ana Oliveira',
  specialty: {
    id: '2bb10d41-bf14-470e-aea0-aa1ec2fb2caf',
    name: 'Radiologia e Diagnóstico por Imagem',
  } as MedicalSpecialtyEntity,
  crm: 'CRM/SE 123456',
} as PhysicianEntity

describe('ExamPrescriptionsService', () => {
  const findExam = jest.fn<Promise<ExamEntity | null>, [unknown]>()
  const findUser = jest.fn<Promise<AuthUserEntity | null>, [unknown]>()
  const findPhysician = jest.fn<Promise<PhysicianEntity | null>, [unknown]>()
  const readText = jest.fn<Promise<string | null>, [string]>()
  const put = jest.fn<
    Promise<void>,
    [string, { body: Buffer | string; contentType: string; cacheControl: string }]
  >()
  const signedGetUrl = jest.fn<Promise<string>, [string]>()
  const users = { findOneBy: findUser } as unknown as Repository<AuthUserEntity>
  const physicians = { findOne: findPhysician } as unknown as Repository<PhysicianEntity>
  const objects = { readText, put, signedGetUrl } as unknown as R2ObjectStorage
  const service = new ExamPrescriptionsService(
    users,
    physicians,
    objects,
    { require: findExam } as unknown as ExamAccessService,
    {
      external: (_context: unknown, _event: unknown, operation: () => Promise<unknown>) =>
        operation(),
    } as unknown as OperationalAuditService,
    {
      current: () =>
        Promise.resolve({
          effective: { headerText: 'Company A', footerText: '', signatureText: 'Doctor A' },
        }),
    } as unknown as CompanyPresentationService,
    {} as PrescriptionProtocolsService,
    { writable: async (_id: string, _context: unknown, operation: (exam: ExamEntity) => Promise<unknown>) => {
      const authorized = await findExam({ id: _id })
      return operation(authorized!)
    } } as WorkflowStoreService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    findExam.mockResolvedValue(exam)
    findUser.mockResolvedValue(doctor)
    findPhysician.mockResolvedValue(physician)
    put.mockResolvedValue()
  })

  it('signs with the authenticated physician profile', async () => {
    const content = { type: 'doc', content: [{ type: 'paragraph' }] }
    const result = await service.sign(exam.id, { content }, context)

    expect(result.signature).toMatchObject({
      userId: doctor.id,
      name: physician.name,
      specialty: physician.specialty.name,
      crm: physician.crm,
    })
    const storedInput = put.mock.calls[0]?.[1]
    expect(typeof storedInput?.body).toBe('string')
    const stored = JSON.parse(String(storedInput?.body)) as {
      signature: { name: string; specialty: string; crm: string }
    }
    expect(stored.signature).toEqual(
      expect.objectContaining({
        name: physician.name,
        specialty: physician.specialty.name,
        crm: physician.crm,
      }),
    )
  })

  it('rejects a signature from an administrator without a physician profile', async () => {
    findUser.mockResolvedValue({ ...doctor, role: 'ADMIN' })
    findPhysician.mockResolvedValue(null)

    await expect(
      service.sign(exam.id, { content: { type: 'doc' } }, context),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(put).not.toHaveBeenCalled()
  })

  it('removes the previous signature when the content is edited and saved', async () => {
    const result = await service.save(exam.id, { content: { type: 'doc' } }, context)

    expect(result.signature).toBeNull()
    const storedInput = put.mock.calls[0]?.[1]
    const stored = JSON.parse(String(storedInput?.body)) as { signature: unknown }
    expect(stored.signature).toBeNull()
  })
})
