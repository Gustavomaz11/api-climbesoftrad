import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer from 'nodemailer'
import type { physicianAccessEmail } from './physician-access-email.template'

@Injectable()
export class PhysicianAccessMailer {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return this.config.get<boolean>('SMTP_ENABLED') === true
  }

  async send(to: string, messageId: string, content: ReturnType<typeof physicianAccessEmail>) {
    if (!this.configured) throw new Error('SMTP_NOT_CONFIGURED')
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
      })
      if (!result.accepted.length || result.rejected.length) throw new Error('SMTP_RECIPIENT_REJECTED')
    } finally { transport.close() }
  }
}
