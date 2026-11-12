import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource, type EntityManager } from 'typeorm'
import { physicianAccessEmail } from './physician-access-email.template'
import { PhysicianAccessMailer } from './physician-access-mailer.service'
import { physicianInitialPassword } from './physician-initial-password'

export type PhysicianEmailStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'
interface PendingEmail { id: string; membership_id: string; initial_access: boolean; attempts: number }
interface Recipient { email: string; username: string; full_name: string; crm: string; must_change_password: boolean; active: boolean }

@Injectable()
export class PhysicianAccessEmails implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private stopped = false
  private readonly logger = new Logger(PhysicianAccessEmails.name)

  constructor(private readonly database: DataSource, private readonly config: ConfigService, private readonly mailer: PhysicianAccessMailer) {}

  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return
    this.timer = setInterval(() => this.requestDelivery(), 30000)
    this.timer.unref()
    this.requestDelivery()
  }

  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer) }

  get configured() { return this.mailer.configured }

  async enqueue(manager: EntityManager, membershipId: string, initialAccess: boolean) {
    await manager.query(`INSERT INTO physician_access_emails(membership_id,initial_access) VALUES($1,$2)`, [membershipId, initialAccess])
    return { status: 'PENDING' as const, configured: this.configured }
  }

  async summaries(membershipIds: string[]) {
    if (!membershipIds.length) return new Map<string, { status: PhysicianEmailStatus; configured: boolean }>()
    const rows = await this.database.query<Array<{ membership_id: string; status: PhysicianEmailStatus }>>(
      'SELECT membership_id,status FROM physician_access_emails WHERE membership_id=ANY($1::uuid[])', [membershipIds])
    return new Map(rows.map(row => [row.membership_id, { status: row.status, configured: this.configured }]))
  }

  requestDelivery() {
    void this.deliverPending().catch(() => this.logger.error('Não foi possível processar a fila de convites médicos.'))
  }

  async deliverPending() {
    if (this.running || this.stopped || !this.configured) return
    this.running = true
    try {
      for (let count = 0; count < 10 && !this.stopped; count++) {
        const [job] = await this.database.query<PendingEmail[]>(`WITH candidate AS (
          SELECT id FROM physician_access_emails WHERE
            (status IN ('PENDING','FAILED') AND attempts<8 AND next_attempt_at<=now())
            OR (status='PROCESSING' AND locked_until<now())
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1), claimed AS (
          UPDATE physician_access_emails e SET status='PROCESSING',attempts=attempts+1,locked_until=now()+interval '2 minutes'
          FROM candidate c WHERE e.id=c.id RETURNING e.*) SELECT * FROM claimed`)
        if (!job) break
        await this.deliver(job)
      }
    } finally { this.running = false }
  }

  private async deliver(job: PendingEmail) {
    const [recipient] = await this.database.query<Recipient[]>(`SELECT u.email,u.username,u.full_name,p.crm,u.must_change_password,
      (m.active AND u.status='ACTIVE' AND c.active) AS active FROM company_memberships m
      JOIN auth_users u ON u.id=m.user_id JOIN physicians p ON p.user_id=u.id JOIN companies c ON c.id=m.company_id
      WHERE m.id=$1`, [job.membership_id])
    if (!recipient?.active) {
      await this.database.query("UPDATE physician_access_emails SET status='CANCELLED',locked_until=NULL WHERE id=$1", [job.id])
      return
    }
    try {
      await this.mailer.send(recipient.email, job.id, physicianAccessEmail({
        name: recipient.full_name, username: recipient.username,
        initialPassword: job.initial_access && recipient.must_change_password ? physicianInitialPassword(recipient.crm) : null,
        loginUrl: new URL('/login', this.config.getOrThrow<string>('SOURAD_WEB_URL')).href,
      }))
      await this.database.query("UPDATE physician_access_emails SET status='SENT',sent_at=now(),locked_until=NULL WHERE id=$1", [job.id])
    } catch {
      await this.database.query(`UPDATE physician_access_emails SET status='FAILED',locked_until=NULL,
        next_attempt_at=now()+($2*interval '1 minute') WHERE id=$1`, [job.id, Math.min(60, 2 ** job.attempts)])
      this.logger.warn(`Falha no envio do convite ${job.id}; tentativa ${job.attempts}.`)
    }
  }
}
