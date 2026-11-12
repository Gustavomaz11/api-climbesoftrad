import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createHash } from 'node:crypto'
import type { physicianAccessEmail } from './physician-access-email.template'
import { physicianEmailLogo } from './physician-email-brand'

@Injectable()
export class PhysicianAccessMailer {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    if (this.config.get<string>('EMAIL_PROVIDER') === 'RESEND')
      return Boolean(this.config.get<string>('API_RESEND_KEY') && this.config.get<string>('EMAIL_FROM'))
    return this.config.get<boolean>('SMTP_ENABLED') === true
  }

  async send(to: string, messageId: string, content: ReturnType<typeof physicianAccessEmail>) {
    if (!this.configured) throw new Error('EMAIL_NOT_CONFIGURED')
    if (this.config.get<string>('EMAIL_PROVIDER') === 'RESEND') return this.sendResend(to, messageId, content)
    const transport = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.getOrThrow<number>('SMTP_PORT'),
      secure: this.config.getOrThrow<boolean>('SMTP_SECURE'),
      requireTLS: true,
      auth: { user: this.config.getOrThrow<string>('SMTP_USER'), pass: this.config.getOrThrow<string>('SMTP_PASSWORD') },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      disableFileAccess: true, disableUrlAccess: true,
    })
    try {
      const result = await transport.sendMail({
        from: { name: 'ClimbeSoftRad', address: this.config.getOrThrow<string>('SMTP_FROM') },
        to, messageId: `<${messageId}@climbesoftrad>`, ...content,
        replyTo: this.config.get<string>('EMAIL_REPLY_TO') || undefined,
        attachments: [physicianEmailLogo],
      })
      if (!result.accepted.length || result.rejected.length) throw new Error('SMTP_RECIPIENT_REJECTED')
    } finally { transport.close() }
  }

  private async sendResend(to: string, messageId: string, content: ReturnType<typeof physicianAccessEmail>) {
    const client = new Resend(this.config.getOrThrow<string>('API_RESEND_KEY'))
    const payload = {
      from: `ClimbeSoftRad <${this.config.getOrThrow<string>('EMAIL_FROM')}>`, to: [to], ...content,
      replyTo: this.config.get<string>('EMAIL_REPLY_TO') || undefined,
      attachments: [{ filename: physicianEmailLogo.filename, content: physicianEmailLogo.content, contentId: physicianEmailLogo.cid, contentType: physicianEmailLogo.contentType }],
      tags: [{ name: 'application', value: 'climbesoftrad' }, { name: 'purpose', value: 'physician_access' }],
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)
    try {
      const { data, error } = await client.emails.send(payload, { idempotencyKey: `climbesoftrad/physician-access/${messageId}/${fingerprint}`, signal: AbortSignal.timeout(20000) })
      if (error || !data?.id) throw new Error('RESEND_DELIVERY_FAILED')
    } catch {
      // Provider errors may contain submitted message content or credentials.
      throw new Error('RESEND_DELIVERY_FAILED')
    }
  }
}
