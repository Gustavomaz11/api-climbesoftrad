import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { CatalogConsumersModule } from '../catalog-consumers/catalog-consumers.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { ContrastProtocolsController } from './contrast-protocols.controller'
import { ContrastProtocolsService } from './contrast-protocols.service'
import { PrescriptionProtocolsService } from './prescription-protocols.service'
@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    CatalogConsumersModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  controllers: [ContrastProtocolsController],
  providers: [ContrastProtocolsService, PrescriptionProtocolsService, ExamAccessService],
  exports: [PrescriptionProtocolsService],
})
export class ContrastProtocolsModule {}
