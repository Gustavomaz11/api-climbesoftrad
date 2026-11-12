import type { DataSource } from 'typeorm'
import { OperationalAuditService } from './operational-audit.service'
import { companyTestContext as context } from '../../../test/company-test-context'

describe('Operational audit of external writes', () => {
  const create = jest.fn((input: unknown) => input)
  const save = jest.fn((input: object) => Promise.resolve({ ...input, id: 'event-id' }))
  const update = jest.fn()
  const repository = { create, save, update }
  const service = new OperationalAuditService({
    getRepository: () => repository,
  } as unknown as DataSource)
  const event = { action: 'REPORT_SAVED' as const, resourceType: 'exam', resourceId: 'exam-id' }

  beforeEach(() => {
    jest.clearAllMocks()
    update.mockReset().mockResolvedValue({})
  })

  it('records intent before storage and success only after it applies', async () => {
    const operation = jest.fn(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'PENDING', companyId: context.companyId }),
      )
      expect(update).not.toHaveBeenCalled()
      return Promise.resolve('saved')
    })
    await expect(service.external(context, event, operation)).resolves.toBe('saved')
    expect(update).toHaveBeenCalledWith(
      'event-id',
      expect.objectContaining({ outcome: 'SUCCEEDED' }),
    )
  })

  it('keeps an unconfirmed external operation pending', async () => {
    await expect(
      service.external(context, event, () => Promise.reject(new Error('storage failed'))),
    ).rejects.toThrow('storage failed')
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps pending when storage applied but completion could not be recorded', async () => {
    update.mockRejectedValue(new Error('database failed'))
    await expect(service.external(context, event, () => Promise.resolve())).rejects.toThrow(
      'database failed',
    )
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalledWith(
      'event-id',
      expect.objectContaining({ outcome: 'FAILED' }),
    )
  })
})
