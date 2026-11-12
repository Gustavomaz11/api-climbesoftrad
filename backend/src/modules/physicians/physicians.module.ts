import { Module } from '@nestjs/common'
import { CompaniesModule } from '../companies/companies.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { MedicalSpecialtyEntity } from '../../database/entities/medical-specialty.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { AuthModule } from '../auth/auth.module'
import { PhysiciansController } from './physicians.controller'
import { PhysiciansService } from './physicians.service'
import { PhysicianRegistryService } from './physician-registry.service'
import { PhysicianQualificationsController } from './physician-qualifications.controller'
import { PhysicianQualificationsService } from './physician-qualifications.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { ExamPhysicianEligibilityService } from './exam-physician-eligibility.service'
import { FileValidationModule } from '../file-validation/file-validation.module'
import { PhysicianSignatureController } from './physician-signature.controller'
import { PhysicianSignatureService } from './physician-signature.service'

@Module({
  imports: [
    CompaniesModule,
    CompanyAccessModule,
    TypeOrmModule.forFeature([PhysicianEntity, MedicalSpecialtyEntity, AuthSessionEntity]),
    AuthModule,
    FileValidationModule,
  ],
  controllers: [PhysicianSignatureController, PhysiciansController, PhysicianQualificationsController],
  providers: [
    PhysiciansService,
    PhysicianSignatureService,
    PhysicianRegistryService,
    PhysicianQualificationsService,
    ExamPhysicianEligibilityService,
    ExamAccessService,
  ],
})
export class PhysiciansModule {}
