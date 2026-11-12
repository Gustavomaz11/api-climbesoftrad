import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { EntityManager, Repository } from 'typeorm'
import {
  AuthSecurityEventEntity,
  type SecurityEventType,
} from '../../database/entities/auth-security-event.entity'
import type { RequestMetadata } from './auth.contracts'

interface SecurityEventInput extends RequestMetadata {
  eventType: SecurityEventType
  userId?: string | null
  sessionId?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

@Injectable()
export class SecurityEventRecorder {
  constructor(
    @InjectRepository(AuthSecurityEventEntity)
    private readonly eventRepository: Repository<AuthSecurityEventEntity>,
  ) {}

  async record(input: SecurityEventInput, manager?: EntityManager): Promise<void> {
    const repository = manager
      ? manager.getRepository(AuthSecurityEventEntity)
      : this.eventRepository

    await repository.save(
      repository.create({
        eventType: input.eventType,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
        metadata: input.metadata ?? {},
      }),
    )
  }
}
