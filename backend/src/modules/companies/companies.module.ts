import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from './company-access.module'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'
import { CompanyMembershipsController } from './company-memberships.controller'
import { CompanyMembershipReader } from './company-membership-reader'
import { CompanyMembershipService } from './company-membership.service'
import { CompanyUserProvisioner } from './company-user-provisioner'
import { CompanySettingsController } from './company-settings.controller'

@Module({
  imports: [TypeOrmModule.forFeature([AuthSessionEntity]), AuthModule, CompanyAccessModule],
  controllers: [CompaniesController, CompanyMembershipsController, CompanySettingsController],
  providers: [
    CompaniesService,
    CompanyMembershipReader,
    CompanyMembershipService,
    CompanyUserProvisioner,
  ],
  exports: [CompanyMembershipReader, CompanyMembershipService],
})
export class CompaniesModule {}
