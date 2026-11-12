import { Injectable } from '@nestjs/common'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import type { UploadedPart } from '../document-uploads/upload.policy'
@Injectable()
export class R2MultipartStorage {
  constructor(private readonly objects: R2ObjectStorage) {}
  async putPart(key: string, id: string, number: number, body: Buffer) {
    await this.objects
      .getClient()
      .send(
        new UploadPartCommand({
          Bucket: this.objects.bucket,
          Key: key,
          UploadId: id,
          PartNumber: number,
          Body: body,
          ContentLength: body.length,
          ContentMD5: createHash('md5').update(body).digest('base64'),
        }),
      )
  }
  async begin(key: string, contentType: string, sha256: string) {
    const output = await this.objects.getClient().send(
      new CreateMultipartUploadCommand({
        Bucket: this.objects.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: 'private, no-store',
        Metadata: { sha256 },
      }),
    )
    if (!output.UploadId) throw new Error('Armazenamento não criou a sessão.')
    return output.UploadId
  }
  signPart(key: string, id: string, number: number) {
    return getSignedUrl(
      this.objects.getClient(),
      new UploadPartCommand({
        Bucket: this.objects.bucket,
        Key: key,
        UploadId: id,
        PartNumber: number,
      }),
      { expiresIn: 300 },
    )
  }
  async parts(key: string, id: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = []
    let marker: string | undefined
    do {
      const output = await this.objects.getClient().send(
        new ListPartsCommand({
          Bucket: this.objects.bucket,
          Key: key,
          UploadId: id,
          PartNumberMarker: marker,
        }),
      )
      for (const part of output.Parts ?? [])
        parts.push({ number: part.PartNumber!, size: part.Size!, etag: part.ETag! })
      marker = output.IsTruncated ? output.NextPartNumberMarker : undefined
    } while (marker)
    return parts
  }
  async complete(key: string, id: string, parts: UploadedPart[]) {
    await this.objects.getClient().send(
      new CompleteMultipartUploadCommand({
        Bucket: this.objects.bucket,
        Key: key,
        UploadId: id,
        MultipartUpload: {
          Parts: parts.map((part) => ({ PartNumber: part.number, ETag: part.etag })),
        },
      }),
    )
  }
  async abort(key: string, id: string) {
    try {
      await this.objects
        .getClient()
        .send(
          new AbortMultipartUploadCommand({ Bucket: this.objects.bucket, Key: key, UploadId: id }),
        )
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'NoSuchUpload') throw error
    }
  }
  async stream(key: string): Promise<Readable> {
    const output = await this.objects
      .getClient()
      .send(new GetObjectCommand({ Bucket: this.objects.bucket, Key: key }))
    if (!output.Body) throw new Error('Arquivo indisponível.')
    return output.Body as Readable
  }
}
