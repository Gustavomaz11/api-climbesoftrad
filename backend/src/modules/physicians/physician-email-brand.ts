import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const physicianEmailLogo = {
  filename: 'climbesoftrad-logo.png',
  content: readFileSync(join(__dirname, '../../assets/mail/climbesoftrad-logo.png')),
  cid: 'climbesoftrad-logo',
  contentType: 'image/png',
}
