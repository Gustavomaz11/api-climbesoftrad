import { Module } from '@nestjs/common'
import { CompaniesModule } from '../companies/companies.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { CatalogConsumerScopeService } from './catalog-consumer-scope.service'
@Module({
  imports: [CompaniesModule, CompanyAccessModule],
  providers: [CatalogConsumerScopeService],
  exports: [CatalogConsumerScopeService],
})
export class CatalogConsumersModule {}
