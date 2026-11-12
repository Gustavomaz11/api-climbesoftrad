import { Module } from '@nestjs/common'
import { CompanyAccessModule } from '../companies/company-access.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { AuthModule } from '../auth/auth.module'
import { HospitalUnitsController } from './hospital-units.controller'
import { HospitalUnitsService } from './hospital-units.service'
import { CnpjaService } from './cnpja.service'
import { RouterModule } from '../router/router.module'

@Module({
  imports: [
    CompanyAccessModule,
    TypeOrmModule.forFeature([HospitalUnitEntity, AuthSessionEntity]),
    AuthModule,
    RouterModule,
  ],
  controllers: [HospitalUnitsController],
  providers: [HospitalUnitsService, CnpjaService],
})
export class HospitalUnitsModule {}
