import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import { ExamTypeEntity } from '../../database/entities/exam-type.entity'
import { PrescriptionProtocolSelectionEntity } from '../../database/entities/prescription-protocol-selection.entity'
import { ContrastProtocolsService } from './contrast-protocols.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAccessService } from '../exams/exam-access.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { SelectContrastProtocolDto } from './contrast-protocol.dto'
import { renderContrastTemplate } from './contrast-template.policy'
import { assertExamOperationallyWritable } from '../exam-workflow/workflow-mutation-policy'
@Injectable()
export class PrescriptionProtocolsService {
  constructor(
    private readonly database: DataSource,
    private readonly protocols: ContrastProtocolsService,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
  ) {}
  async forExam(examId: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    if (exam.normalizationStatus !== 'APPROVED' || !exam.examTypeId)
      return { items: [], reason: 'CLASSIFICATION_REQUIRED' }
    if (
      !(await this.database.getRepository(ExamTypeEntity).existsBy({
        id: exam.examTypeId,
        companyId: context.companyId,
        active: true,
        modality: exam.modality,
      }))
    )
      return { items: [], reason: 'INACTIVE_EXAM_TYPE' }
    const items = (await this.protocols.list(context)).filter(
      (protocol) =>
        protocol.status === 'ACTIVE' &&
        protocol.examTypeId === exam.examTypeId &&
        protocol.modality === exam.modality &&
        (!protocol.unitId || protocol.unitId === exam.unitId),
    )
    return { items, reason: items.length ? null : 'NO_ACTIVE_PROTOCOL' }
  }
  async select(examId: string, dto: SelectContrastProtocolDto, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    return this.database.transaction(async (manager) => {
      const exam = await manager.getRepository(ExamEntity).findOneOrFail({
        where: { id: examId, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      assertExamOperationallyWritable(exam)
      const visible = await this.protocols.require(dto.protocolId, context, manager)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'contrast-protocol:' + visible.familyId,
      ])
      const protocol = await this.protocols.require(dto.protocolId, context, manager)
      if (exam.normalizationStatus !== 'APPROVED' || !exam.examTypeId)
        throw new ConflictException(
          'Confira a classificação do exame antes de selecionar um protocolo.',
        )
      if (
        !(await manager.getRepository(ExamTypeEntity).existsBy({
          id: exam.examTypeId,
          companyId: context.companyId,
          active: true,
          modality: exam.modality,
        }))
      )
        throw new BadRequestException('Tipo de exame inativo.')
      if (
        protocol.status !== 'ACTIVE' ||
        protocol.examTypeId !== exam.examTypeId ||
        protocol.modality !== exam.modality ||
        (protocol.unitId && protocol.unitId !== exam.unitId)
      )
        throw new BadRequestException('Protocolo inativo ou incompatível com este exame.')
      const text = renderContrastTemplate(
        protocol.template,
        protocol.fields,
        dto.values,
        dto.observations,
      )
      const values = Object.fromEntries(
        protocol.fields.map((field) => {
          const value = dto.values[field.key]
          return [field.key, typeof value === 'string' ? value.trim() : '']
        }),
      )
      const record = await manager.getRepository(PrescriptionProtocolSelectionEntity).save({
        companyId: context.companyId,
        examId,
        protocolId: protocol.id,
        createdByUserId: context.userId,
        snapshot: {
          protocolId: protocol.id,
          protocolVersion: protocol.version,
          name: protocol.name,
          examTypeId: protocol.examTypeId,
          modality: protocol.modality,
          template: protocol.template,
          fields: protocol.fields,
          values,
          observations: dto.observations,
          notes: protocol.notes,
          renderedText: text,
        },
      })
      await this.audit.record(
        context,
        {
          action: 'PRESCRIPTION_PROTOCOL_SELECTED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: {
            selectionId: record.id,
            protocolId: protocol.id,
            protocolVersion: protocol.version,
          },
        },
        manager,
      )
      return {
        selectionId: record.id,
        snapshot: record.snapshot,
        content: {
          type: 'doc',
          content: text.split('\n').map((line) => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
          })),
        },
      }
    })
  }
  async snapshot(id: string, examId: string, context: CompanyAccessContext) {
    const selection = await this.database
      .getRepository(PrescriptionProtocolSelectionEntity)
      .findOneBy({ id, examId, companyId: context.companyId })
    if (!selection) throw new NotFoundException('Seleção de protocolo não encontrada neste exame.')
    return { selectionId: selection.id, ...selection.snapshot }
  }
}
