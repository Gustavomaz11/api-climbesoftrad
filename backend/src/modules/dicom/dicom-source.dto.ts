import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, Matches, Max } from 'class-validator'
export class CreateDicomSourceDto {
  @IsUUID() unitId: string
  @IsString() @Matches(/\S/) @MaxLength(120) name: string
}
export class AgentDiagnosticDto {
  @IsOptional() @IsBoolean() diagnosticOnly?: boolean
  @IsString() @Matches(/^[a-zA-Z0-9.-]+$/) @MaxLength(40) version: string
  @IsInt() @Min(0) @Max(1000000) pending: number
  @IsInt() @Min(0) @Max(1000000) failed: number
  @IsInt() @Min(0) freeBytes: number
  @IsOptional() @IsString() @Matches(/^[A-Z_0-9]+$/) @MaxLength(60) errorCode?: string
}
