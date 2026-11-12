import { Module } from '@nestjs/common'
import { ResearchAiModule } from './modules/research-ai/research-ai.module'
import { ExamModalitiesModule } from './modules/exam-modalities/exam-modalities.module'
import { ExamWorkflowModule } from './modules/exam-workflow/exam-workflow.module'
import { DocumentUploadsModule } from './modules/document-uploads/document-uploads.module'
import { DicomModule } from './modules/dicom/dicom.module'
import { ContrastProtocolsModule } from './modules/contrast-protocols/contrast-protocols.module'
import { ExamPricingModule } from './modules/exam-pricing/exam-pricing.module'
import { CompaniesModule } from './modules/companies/companies.module'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ApiExceptionFilter } from './common/filters/api-exception.filter'
import { validateEnvironment } from './config/environment'
import { DatabaseModule } from './database/database.module'
import { AuthModule } from './modules/auth/auth.module'
import { ExamsModule } from './modules/exams/exams.module'
import { HealthModule } from './modules/health/health.module'
import { HospitalUnitsModule } from './modules/hospital-units/hospital-units.module'
import { PhysiciansModule } from './modules/physicians/physicians.module'
import { AccessControlModule } from './modules/access-control/access-control.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'burst',
            ttl: config.getOrThrow<number>('RATE_LIMIT_BURST_WINDOW_SECONDS') * 1_000,
            limit: config.getOrThrow<number>('RATE_LIMIT_BURST_REQUESTS'),
          },
          {
            name: 'default',
            ttl: config.getOrThrow<number>('RATE_LIMIT_STANDARD_WINDOW_SECONDS') * 1_000,
            limit: config.getOrThrow<number>('RATE_LIMIT_STANDARD_REQUESTS'),
          },
          {
            name: 'sustained',
            ttl: config.getOrThrow<number>('RATE_LIMIT_SUSTAINED_WINDOW_SECONDS') * 1_000,
            limit: config.getOrThrow<number>('RATE_LIMIT_SUSTAINED_REQUESTS'),
          },
        ],
        setHeaders: true,
        errorMessage: 'Muitas requisiÃ§Ãµes. Aguarde alguns instantes e tente novamente.',
      }),
    }),
    DatabaseModule,
    ResearchAiModule,
    ExamModalitiesModule,
    ExamWorkflowModule,
    DocumentUploadsModule,
    DicomModule,
    ContrastProtocolsModule,
    ExamPricingModule,
    AuthModule,
    CompaniesModule,
    HealthModule,
    ExamsModule,
    PhysiciansModule,
    HospitalUnitsModule,
    AccessControlModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
