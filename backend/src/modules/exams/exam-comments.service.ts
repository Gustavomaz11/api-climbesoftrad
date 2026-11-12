import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'node:crypto'
import { DataSource, type Repository } from 'typeorm'
import { ExamCommentAttachmentEntity } from '../../database/entities/exam-comment-attachment.entity'
import { ExamCommentEntity } from '../../database/entities/exam-comment.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAccessService } from './exam-access.service'
import type { CreateExamCommentDto } from './dto/create-exam-comment.dto'
import { R2ObjectStorage } from './r2-object-storage.service'
import { assertUploadedFileSignature } from './uploaded-file-security'

const attachmentExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
}

export interface CommentResponse {
  id: string
  body: string
  authorName: string
  createdAt: Date
  attachments: AttachmentResponse[]
  replies: CommentResponse[]
}

export interface AttachmentResponse {
  id: string
  name: string
  contentType: string
  sizeBytes: number
  url: string
}

@Injectable()
export class ExamCommentsService {
  constructor(
    @InjectRepository(ExamCommentEntity)
    private readonly comments: Repository<ExamCommentEntity>,
    @InjectRepository(ExamCommentAttachmentEntity)
    private readonly attachments: Repository<ExamCommentAttachmentEntity>,
    private readonly objects: R2ObjectStorage,
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
  ) {}

  async list(examId: string, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    const comments = await this.comments.find({
      where: { examId },
      relations: { author: true, attachments: true },
      order: { createdAt: 'ASC' },
    })
    const serialized = await Promise.all(
      comments.map((comment) =>
        this.serialize(comment, context.permissions.includes('attachments.view')),
      ),
    )
    const repliesByParent = new Map<string, CommentResponse[]>()

    comments.forEach((comment, index) => {
      if (!comment.parentCommentId) return
      const response = serialized[index]
      if (!response) return
      const replies = repliesByParent.get(comment.parentCommentId) ?? []
      replies.push(response)
      repliesByParent.set(comment.parentCommentId, replies)
    })

    const items = comments.flatMap((comment, index) => {
      if (comment.parentCommentId) return []
      const response = serialized[index]
      if (!response) return []
      return [{ ...response, replies: repliesByParent.get(comment.id) ?? [] }]
    })
    return { items, total: comments.length }
  }

  async create(
    examId: string,
    dto: CreateExamCommentDto,
    files: Express.Multer.File[],
    context: CompanyAccessContext,
  ) {
    const exam = await this.access.require(examId, context)
    const body = dto.body.trim()
    if (!body) throw new BadRequestException('Digite um comentário.')
    this.validateFiles(files)
    const parentCommentId = await this.resolveRootParent(examId, dto.parentCommentId)
    const uploadedKeys: string[] = []
    try {
      await this.database.transaction(async (manager) => {
        const comments = manager.getRepository(ExamCommentEntity)
        const comment = await comments.save(
          comments.create({
            examId,
            parentCommentId,
            authorUserId: context.userId,
            body,
          }),
        )
        const attachments: ExamCommentAttachmentEntity[] = []
        for (const file of files) {
          attachments.push(
            await this.uploadAttachment(
              examId,
              comment.id,
              file,
              uploadedKeys,
              context,
              exam.unitId,
            ),
          )
        }
        if (attachments.length)
          await manager.getRepository(ExamCommentAttachmentEntity).save(attachments)
        await this.audit.record(
          context,
          {
            action: 'COMMENT_CREATED',
            resourceType: 'exam',
            resourceId: examId,
            unitId: exam.unitId,
            metadata: {
              commentId: comment.id,
              attachmentCount: files.length,
              reply: Boolean(parentCommentId),
            },
          },
          manager,
        )
      })
    } catch (error: unknown) {
      await Promise.allSettled(
        uploadedKeys.map((key) =>
          this.audit.external(
            context,
            {
              action: 'COMMENT_ATTACHMENT_REMOVED',
              resourceType: 'exam',
              resourceId: examId,
              unitId: exam.unitId,
              reason: 'Compensação após falha no cadastro do comentário',
              metadata: { storageKey: key },
            },
            () => this.objects.delete(key),
          ),
        ),
      )
      throw error
    }
    if (!context.permissions.includes('comments.view')) {
      return { items: [], total: await this.comments.countBy({ examId }) }
    }
    return this.list(examId, context)
  }

  private async resolveRootParent(examId: string, parentId?: string): Promise<string | null> {
    if (!parentId) return null
    const parent = await this.comments.findOne({ where: { id: parentId, examId } })
    if (!parent) throw new NotFoundException('Comentário original não encontrado.')
    return parent.parentCommentId ?? parent.id
  }

  private validateFiles(files: Express.Multer.File[]): void {
    files.forEach(assertUploadedFileSignature)
    const invalidFile = files.find((file) => !attachmentExtensions[file.mimetype])
    if (invalidFile)
      throw new BadRequestException(`O arquivo ${invalidFile.originalname} não é permitido.`)
  }

  private async uploadAttachment(
    examId: string,
    commentId: string,
    file: Express.Multer.File,
    uploadedKeys: string[],
    context: CompanyAccessContext,
    unitId: string,
  ): Promise<ExamCommentAttachmentEntity> {
    const extension = attachmentExtensions[file.mimetype]
    const key = `comments/${examId}/${commentId}/${randomUUID()}.${extension}`
    uploadedKeys.push(key)
    await this.audit.external(
      context,
      {
        action: 'COMMENT_ATTACHMENT_UPLOADED',
        resourceType: 'exam',
        resourceId: examId,
        unitId,
        metadata: {
          storageKey: key,
          sizeBytes: file.size,
          payloadHash: createHash('sha256').update(file.buffer).digest('hex'),
        },
      },
      () =>
        this.objects.put(key, {
          body: file.buffer,
          contentType: file.mimetype,
          cacheControl: 'private, max-age=3600',
        }),
    )
    return this.attachments.create({
      commentId,
      storageKey: key,
      originalName: file.originalname.slice(0, 255),
      contentType: file.mimetype,
      sizeBytes: file.size,
    })
  }

  private async serialize(
    comment: ExamCommentEntity,
    canViewAttachments: boolean,
  ): Promise<CommentResponse> {
    return {
      id: comment.id,
      body: comment.body,
      authorName: comment.author.fullName,
      createdAt: comment.createdAt,
      attachments: canViewAttachments
        ? await Promise.all(
            comment.attachments.map(async (attachment) => ({
              id: attachment.id,
              name: attachment.originalName,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              url: await this.objects.signedGetUrl(attachment.storageKey),
            })),
          )
        : [],
      replies: [],
    }
  }
}
