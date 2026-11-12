import { ConfigService } from '@nestjs/config'
import nodemailer from 'nodemailer'
import { PhysicianAccessMailer } from './physician-access-mailer.service'

jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }))

describe('Physician SMTP delivery', () => {
  const content = { subject: 'Acesso', text: 'Instruções sintéticas', html: '<p>Instruções sintéticas</p>' }
  const create = (enabled = true) => new PhysicianAccessMailer(new ConfigService({
    SMTP_ENABLED: enabled, SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_SECURE: false,
    SMTP_USER: 'sender', SMTP_PASSWORD: 'synthetic-password', SMTP_FROM: 'access@example.test',
  }))
  const sendMail = jest.fn(), close = jest.fn()
  beforeEach(() => {
    jest.clearAllMocks()
    ;(nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail, close })
  })
  it('requires configured delivery and never treats a missing provider as sent', async () => {
    await expect(create(false).send('doctor@example.test', 'job', content)).rejects.toThrow('SMTP_NOT_CONFIGURED')
    expect(nodemailer.createTransport).not.toHaveBeenCalled()
  })
  it('requires encrypted SMTP and certificate validation, without logging message content', async () => {
    sendMail.mockResolvedValue({ accepted: ['doctor@example.test'], rejected: [] })
    await create().send('doctor@example.test', 'job', content)
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true,
    }))
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'doctor@example.test', text: content.text }))
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('rejects refused recipients and closes the transport', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: ['doctor@example.test'] })
    await expect(create().send('doctor@example.test', 'job', content)).rejects.toThrow('SMTP_RECIPIENT_REJECTED')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
