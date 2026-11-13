import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator'
import {BadRequestException} from '@nestjs/common'
import type { ReportNode } from './exam-reports.service'

export class ReportReasonDto {
  @IsString() @MinLength(10) @MaxLength(1000) reason: string
}
export class ReportRevisionDto extends ReportReasonDto {
  @IsInt() @Min(1) expectedVersion: number
  @IsUUID() completionId: string
}
export class ReportAuthorizationDto extends ReportReasonDto {
  @IsUUID() completionId: string
  @IsUUID() physicianUserId: string
}
export class ReportCloseDto {
  @IsUUID() clientId: string
  @IsOptional() @IsObject() content?: Record<string, unknown>
}
export class ReportActivityDto {
  @IsIn(['PRINT_REQUESTED', 'EXPORT_REQUESTED']) activity: 'PRINT_REQUESTED' | 'EXPORT_REQUESTED'
}
export interface ReportDraft {
  exam_id: string; content: ReportNode; content_hash: string; has_content: boolean
  updated_at: Date; updated_by_user_id: string; base_completion_id: string | null; revision_reason: string | null
}
export interface ReportSession {
  exam_id: string; user_id: string; client_id: string; expires_at: Date
  release_requested_at: Date | null; release_reason: string | null
}
export const hasReportContent = (root: ReportNode): boolean => {
  const stack=[{node:root,depth:0}]
  let count=0,found=false
  while(stack.length) {
    const {node,depth}=stack.pop()!
    if(!node || typeof node!=='object' || Array.isArray(node) || ++count>20000 || depth>50) throw new BadRequestException('Estrutura do laudo inválida.')
    if((typeof node.text==='string' && node.text.trim()) || node.type==='image')found=true
    if(node.content!==undefined) {
      if(!Array.isArray(node.content))throw new BadRequestException('Estrutura do laudo inválida.')
      for(const child of node.content)stack.push({node:child,depth:depth+1})
    }
  }
  return found
}
