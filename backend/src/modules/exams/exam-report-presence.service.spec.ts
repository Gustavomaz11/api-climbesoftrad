import { NotFoundException } from '@nestjs/common'
import type { DataSource, EntityManager } from 'typeorm'
import { companyTestContext as context } from '../../../test/company-test-context'
import { ExamReportPresenceService } from './exam-report-presence.service'
import type { ExamAccessService } from './exam-access.service'
import type { OperationalAuditService } from '../companies/operational-audit.service'
import type { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

describe('ExamReportPresenceService', () => {
  const requireExam = jest.fn()
  const existsBy = jest.fn()
  const upsert = jest.fn()
  const deletePresence = jest.fn()
  const record = jest.fn()
  const manager = { getRepository: () => ({ existsBy, upsert, delete: deletePresence }) }
  const database = {
    transaction: (operation: (manager: EntityManager) => Promise<unknown>) =>
      operation(manager as unknown as EntityManager),
  }
  const service = new ExamReportPresenceService(
    database as unknown as DataSource,
    { require: requireExam } as unknown as ExamAccessService,
    { record } as unknown as OperationalAuditService,
    { writable: async (_id: string, _context: unknown, operation: (exam: unknown, manager: unknown) => Promise<unknown>) => {
      const authorized: unknown = await requireExam(_id, _context)
      return operation(authorized, manager)
    } } as WorkflowStoreService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    requireExam.mockResolvedValue({ unitId: context.unitIds[0] })
    existsBy.mockResolvedValue(false)
  })

  it('creates or renews presence within the authorized exam', async () => {
    await expect(service.touch('exam-id', context, 'client-id')).resolves.toEqual({ active: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        examId: 'exam-id',
        userId: context.userId,
        clientId: 'client-id',
        lastSeenAt: expect.any(Date) as unknown,
      }),
      ['examId', 'userId', 'clientId'],
    )
    expect(record).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ action: 'REPORT_PRESENCE_STARTED' }),
      manager,
    )
  })

  it('does not create presence for an inaccessible exam', async () => {
    requireExam.mockRejectedValue(new NotFoundException())
    await expect(service.touch('exam-id', context, 'client-id')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('releases only the current user and client', async () => {
    deletePresence.mockResolvedValue({ affected: 1 })
    await expect(service.release('exam-id', context, 'client-id')).resolves.toEqual({
      active: false,
    })
    expect(deletePresence).toHaveBeenCalledWith({
      examId: 'exam-id',
      userId: context.userId,
      clientId: 'client-id',
    })
  })

  it('does not duplicate an entry event on a heartbeat', async () => {
    existsBy.mockResolvedValue(true)
    await service.touch('exam-id', context, 'client-id')
    expect(record).not.toHaveBeenCalled()
  })
})
