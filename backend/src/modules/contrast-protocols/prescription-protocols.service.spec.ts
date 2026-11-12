import type { DataSource } from 'typeorm'
import type { ContrastProtocolsService } from './contrast-protocols.service'
import type { ExamAccessService } from '../exams/exam-access.service'
import type { OperationalAuditService } from '../companies/operational-audit.service'
import { PrescriptionProtocolsService } from './prescription-protocols.service'
import { companyTestContext as context } from '../../../test/company-test-context'
describe('Prescription protocol version availability', () => {
  const exam = {
    id: 'exam',
    companyId: context.companyId,
    unitId: context.unitIds[0],
    examTypeId: 'type',
    modality: 'CT',
    normalizationStatus: 'APPROVED',
  }
  const requireExam = jest.fn(),
    existsBy = jest.fn(),
    findOneBy = jest.fn(),
    list = jest.fn()
  const database = { getRepository: () => ({ existsBy, findOneBy }) } as unknown as DataSource
  const service = new PrescriptionProtocolsService(
    database,
    { list } as unknown as ContrastProtocolsService,
    { require: requireExam } as unknown as ExamAccessService,
    {} as OperationalAuditService,
  )
  beforeEach(() => {
    jest.clearAllMocks()
    requireExam.mockResolvedValue(exam)
    existsBy.mockResolvedValue(true)
  })
  it('offers only active compatible versions and leaves drafts and retired versions unavailable', async () => {
    const base = { examTypeId: 'type', modality: 'CT', unitId: exam.unitId }
    list.mockResolvedValue([
      { ...base, id: 'old', version: 1, status: 'RETIRED' },
      { ...base, id: 'current', version: 2, status: 'ACTIVE' },
      { ...base, id: 'draft', version: 3, status: 'DRAFT' },
      { ...base, id: 'other', status: 'ACTIVE', unitId: 'other' },
    ])
    expect(await service.forExam('exam', context)).toMatchObject({
      items: [{ id: 'current', version: 2 }],
      reason: null,
    })
  })
  it('keeps the original version in a saved source snapshot instead of replacing it with the current protocol', async () => {
    findOneBy.mockResolvedValue({
      id: 'selection',
      snapshot: { protocolId: 'old', protocolVersion: 1, renderedText: 'Texto preservado' },
    })
    expect(await service.snapshot('selection', 'exam', context)).toEqual({
      selectionId: 'selection',
      protocolId: 'old',
      protocolVersion: 1,
      renderedText: 'Texto preservado',
    })
    expect(findOneBy).toHaveBeenCalledWith({
      id: 'selection',
      examId: 'exam',
      companyId: context.companyId,
    })
  })
  it('blocks unclassified and inactive types before offering protocols', async () => {
    requireExam.mockResolvedValue({ ...exam, normalizationStatus: 'UNKNOWN' })
    expect(await service.forExam('exam', context)).toMatchObject({
      items: [],
      reason: 'CLASSIFICATION_REQUIRED',
    })
    requireExam.mockResolvedValue(exam)
    existsBy.mockResolvedValue(false)
    expect(await service.forExam('exam', context)).toMatchObject({
      items: [],
      reason: 'INACTIVE_EXAM_TYPE',
    })
    expect(list).not.toHaveBeenCalled()
  })
})
