import { Injectable } from '@nestjs/common'
import { R2ObjectStorage } from './r2-object-storage.service'

const reportKey = (examId: string) => `reports/${examId}/report.json`

@Injectable()
export class R2ExamReportStorage {
  constructor(private readonly objects: R2ObjectStorage) {}

  async read(examId: string): Promise<string | null> {
    return this.objects.readText(reportKey(examId))
  }

  async write(examId: string, body: string): Promise<void> {
    await this.objects.put(reportKey(examId), {
      body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-store',
    })
  }

  async uploadImage(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.objects.put(key, {
      body,
      contentType,
      cacheControl: 'private, max-age=3600',
    })
  }

  signedImageUrl(key: string): Promise<string> {
    return this.objects.signedGetUrl(key)
  }
}
