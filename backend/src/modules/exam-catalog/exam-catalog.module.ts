import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { ExamCatalogService } from './exam-catalog.service'
import { ExamDescriptionResolverService } from './exam-description-resolver.service'
import { ExamClassificationService } from './exam-classification.service'
import { ExamCatalogController } from './exam-catalog.controller'
@Module({
  imports: [AuthModule, CompanyAccessModule, TypeOrmModule.forFeature([AuthSessionEntity])],
  providers: [ExamCatalogService, ExamDescriptionResolverService, ExamClassificationService],
  controllers: [ExamCatalogController],
  exports: [ExamDescriptionResolverService],
})
export class ExamCatalogModule {}
