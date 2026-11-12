import { BadRequestException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { ExamDescriptionResolverService } from './exam-description-resolver.service'
import type { CompanyScopeService } from '../companies/company-scope.service'
import { companyTestContext } from '../../../test/company-test-context'
describe('Catalog type validation', () => {
  const findOneBy = jest.fn(),
    database = { manager: { getRepository: () => ({ findOneBy }) } } as unknown as DataSource
  const service = new ExamDescriptionResolverService(database, {} as CompanyScopeService)
  it('accepts the active type in the current company and compatible modality', async () => {
    findOneBy.mockResolvedValue({ id: 'type', active: true, modality: 'CT' })
    await expect(service.requireType('type', 'CT', companyTestContext)).resolves.toMatchObject({
      id: 'type',
    })
    expect(findOneBy).toHaveBeenCalledWith({ id: 'type', companyId: companyTestContext.companyId })
  })
  it('rejects inactive and modality incompatible types', async () => {
    findOneBy.mockResolvedValue({ id: 'type', active: false, modality: 'CT' })
    await expect(service.requireType('type', 'CT', companyTestContext)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    findOneBy.mockResolvedValue({ id: 'type', active: true, modality: 'MR' })
    await expect(service.requireType('type', 'CT', companyTestContext)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
