import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  IsNumber,
  IsPositive,
  Max,
} from 'class-validator'
import {
  examModalities,
  examPriorities,
  type ExamModality,
  type ExamPriority,
} from '../../../database/entities/exam.entity'

export class CreateExamDto {
  @ApiPropertyOptional({ description: 'Altura da paciente em metros, na ocasião do exame' })
  @IsOptional() @IsNumber() @IsPositive() @Max(10) heightMeters?: number | null
  @ApiPropertyOptional({ description: 'Peso da paciente em quilogramas, na ocasião do exame' })
  @IsOptional() @IsNumber() @IsPositive() @Max(10000) weightKg?: number | null
  @ApiPropertyOptional({ description: 'Data original do estudo DICOM, sem conversão de fuso' })
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) studyDate?: string | null
  @ApiPropertyOptional({ description: 'Horário original do estudo DICOM, sem conversão de fuso' })
  @IsOptional() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/) studyTime?: string | null
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) institutionName?: string | null
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) studyId?: string | null
  @IsOptional() @IsUUID() patientId?: string
  @IsOptional() @IsString() @MaxLength(120) originIssuer?: string
  @IsOptional() @IsString() @MaxLength(120) externalPatientId?: string
  @IsOptional() @IsString() @MaxLength(120) externalEncounterId?: string
  @IsOptional() @IsString() @MaxLength(120) sourceExamId?: string
  @IsOptional() @IsUUID() examTypeId?: string

  @ApiProperty({ example: 'Maria da Silva' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  patientName: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  socialName?: string

  @ApiProperty({ enum: ['MASCULINO', 'FEMININO'] })
  @IsIn(['MASCULINO', 'FEMININO'])
  sex: 'MASCULINO' | 'FEMININO'

  @ApiProperty({ example: '1985-04-18' })
  @IsDateString({ strict: true })
  birthDate: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  identity?: string

  @ApiProperty({ default: 'Brasil' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  country: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string

  @ApiProperty({ example: 'RM de joelho direito sem contraste' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  studyDescription: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  accessionNumber?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  orderCode?: string

  @ApiProperty({ enum: examModalities })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,15}$/)
  modality: ExamModality

  @ApiProperty({ example: '3d9b90d3-29d6-44d6-9fd4-95c1ab46d4dd' })
  @IsUUID()
  unitId: string

  @ApiProperty({ enum: examPriorities, default: 'ROTINA' })
  @IsIn(examPriorities)
  priority: ExamPriority

  @ApiPropertyOptional({ description: 'E-mail ou CRM do solicitante' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  requesterReference?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  requesterName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  performingPhysician?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  healthInsurance?: string

  @ApiProperty({ example: '2026-08-23T14:30:00-03:00' })
  @IsDateString({ strict: true })
  performedAt: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  auxiliaryField1?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  auxiliaryField2?: string
}
