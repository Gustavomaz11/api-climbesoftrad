import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { CatalogConsumersModule } from '../catalog-consumers/catalog-consumers.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { ExamPricingController } from './exam-pricing.controller'
import { ExamPricingService } from './exam-pricing.service'
@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    CatalogConsumersModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  controllers: [ExamPricingController],
  providers: [ExamPricingService, ExamAccessService],
})
export class ExamPricingModule {}
