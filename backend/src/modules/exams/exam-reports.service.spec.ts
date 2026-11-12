import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { ExamEntity } from '../../database/entities/exam.entity'
import { companyTestContext as context } from '../../../test/company-test-context'
import { ExamReportsService } from './exam-reports.service'
import type { R2ExamReportStorage } from './r2-exam-report-storage.service'
import type { ExamAccessService } from './exam-access.service'
import type { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyPresentationService } from '../companies/company-presentation.service'
import type { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

const exam = {
  id: '7fb1e38b-685d-4cb2-9dc6-24ab39808267',
  companyId: context.companyId,
  unitId: context.unitIds[0],
  unit: { name: 'Hospital A' },
  patientName: 'Maria dos Santos',
  studyDescription: 'Ressonância magnética do joelho',
  performedAt: new Date(),
  modality: 'MR',
} as ExamEntity

describe('ExamReportsService', () => {
  const requireExam = jest.fn()
  const read = jest.fn()
  const write = jest.fn<Promise<void>, [string, string]>()
  const uploadImage = jest.fn()
  const signedImageUrl = jest.fn()
  const query = jest.fn().mockResolvedValue([])
  const storage = { read, write, uploadImage, signedImageUrl } as unknown as R2ExamReportStorage
  const access = { require: requireExam } as unknown as ExamAccessService
  const external = jest.fn(
    (_context: unknown, _event: unknown, operation: () => Promise<unknown>) => operation(),
  )
  const audit = { external } as unknown as OperationalAuditService
  const presentation = {
    current: jest
      .fn()
      .mockResolvedValue({ effective: { headerText: '', footerText: '', signatureText: '' } }),
  }
  const service = new ExamReportsService(
    storage,
    access,
    audit,
    presentation as unknown as CompanyPresentationService,
    { writable: async (_id: string, _context: unknown, operation: (exam: ExamEntity, manager: EntityManager) => Promise<unknown>) => {
      const authorized = await requireExam(_id, _context) as ExamEntity
      return operation(authorized, { query } as unknown as EntityManager)
    } } as WorkflowStoreService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    requireExam.mockResolvedValue(exam)
    query.mockResolvedValue([])
  })

  it('returns an empty editable document before the first save', async () => {
    read.mockResolvedValue(null)
    await expect(service.get(exam.id, context)).resolves.toMatchObject({
      exam: { id: exam.id, patientName: exam.patientName },
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      updatedAt: null,
    })
  })

  it('saves and restores image URLs only after resource authorization', async () => {
    const key = `reports/${exam.id}/images/image.png`
    const content = {
      type: 'doc',
      content: [{ type: 'image', attrs: { storageKey: key, src: 'expired-url' } }],
    }
    await service.save(exam.id, { content }, context)
    read.mockResolvedValue(write.mock.calls[0]?.[1])
    signedImageUrl.mockResolvedValue('https://signed.example/image.png')
    const reopened = await service.get(exam.id, context)
    expect(reopened.content.content?.[0]?.attrs?.src).toBe('https://signed.example/image.png')
    expect(requireExam).toHaveBeenCalledWith(exam.id, context)
    expect(external).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ action: 'REPORT_SAVED' }),
      expect.any(Function),
    )
  })

  it('rejects unsupported images', async () => {
    await expect(
      service.uploadImage(exam.id, { mimetype: 'application/pdf' } as Express.Multer.File, context),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('preserves a finalized report against text and image writes', async () => {
    query.mockResolvedValue([{ id: 'completed' }])
    await expect(service.save(exam.id, { content: { type: 'doc' } }, context)).rejects.toBeInstanceOf(ConflictException)
    await expect(service.uploadImage(exam.id, {} as Express.Multer.File, context)).rejects.toBeInstanceOf(ConflictException)
    expect(write).not.toHaveBeenCalled()
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('never reads, signs links or writes storage for an inaccessible exam', async () => {
    requireExam.mockRejectedValue(new NotFoundException())
    await expect(service.get(exam.id, context)).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.uploadImage(exam.id, {} as Express.Multer.File, context),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(read).not.toHaveBeenCalled()
    expect(signedImageUrl).not.toHaveBeenCalled()
    expect(uploadImage).not.toHaveBeenCalled()
  })
})
