import { Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import {
  OperationalEventEntity,
  type OperationalAction,
  type OperationalMetadata,
} from '../../database/entities/operational-event.entity'
import type { AuthenticatedRequestData } from '../auth/auth.contracts'

export interface AuditContext extends Pick<
  AuthenticatedRequestData,
  'userId' | 'sessionId' | 'correlationId'
> {
  companyId: string
  integrationSourceId?: string
}

export interface AuditEvent {
  action: OperationalAction
  resourceType: string
  resourceId?: string | null
  unitId?: string | null
  reason?: string | null
  metadata?: OperationalMetadata
}

@Injectable()
export class OperationalAuditService {
  constructor(private readonly database: DataSource) {}

  async record(
    context: AuditContext,
    event: AuditEvent,
    manager: EntityManager = this.database.manager,
  ) {
    const repository = manager.getRepository(OperationalEventEntity)
    return repository.save(
      repository.create({
        ...event,
        companyId: context.companyId,
        actorUserId: context.userId,
        sessionId: context.sessionId || null,
        correlationId: context.correlationId,
        resourceId: event.resourceId ?? null,
        unitId: event.unitId ?? null,
        reason: event.reason ?? null,
        metadata: { ...event.metadata, ...(context.integrationSourceId ? { sourceId: context.integrationSourceId } : {}) },
        outcome: 'SUCCEEDED',
        completedAt: new Date(),
      }),
    )
  }

  async external<T>(
    context: AuditContext,
    event: AuditEvent,
    operation: () => Promise<T>,
  ): Promise<T> {
    const repository = this.database.getRepository(OperationalEventEntity)
    const pending = await repository.save(
      repository.create({
        ...event,
        companyId: context.companyId,
        actorUserId: context.userId,
        sessionId: context.sessionId || null,
        correlationId: context.correlationId,
        resourceId: event.resourceId ?? null,
        unitId: event.unitId ?? null,
        reason: event.reason ?? null,
        metadata: { ...event.metadata, ...(context.integrationSourceId ? { sourceId: context.integrationSourceId } : {}) },
        outcome: 'PENDING',
        completedAt: null,
      }),
    )
    // A network failure can occur after storage accepts the write. Leave
    // unconfirmed intents pending for reconciliation in both failure stages.
    const result = await operation()
    await repository.update(pending.id, { outcome: 'SUCCEEDED', completedAt: new Date() })
    return result
  }
}
