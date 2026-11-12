import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

interface StoredObjectInput {
  body: Buffer | string
  contentType: string
  cacheControl: string
  metadata?: Record<string, string>
}

@Injectable()
export class R2ObjectStorage {
  private client: S3Client | null = null

  constructor(private readonly config: ConfigService) {}

  async readText(key: string): Promise<string | null> {
    try {
      const response = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      return await this.bodyAsString(response)
    } catch (error: unknown) {
      if (this.isNotFound(error)) return null
      throw error
    }
  }

  async put(key: string, input: StoredObjectInput): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
        Metadata: input.metadata,
      }),
    )
  }

  signedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    )
  }

  async stat(key: string): Promise<{ sizeBytes: number; sha256?: string } | null> {
    try {
      const response = await this.getClient().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { sizeBytes: response.ContentLength ?? 0, sha256: response.Metadata?.sha256 }
    } catch (error: unknown) {
      if (this.isNotFound(error)) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await this.getClient().send(new CopyObjectCommand({
      Bucket: this.bucket, Key: destinationKey,
      CopySource: [this.bucket, ...sourceKey.split('/')].map(encodeURIComponent).join('/'),
      MetadataDirective: 'COPY',
    }))
  }

  get bucket(): string {
    return this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET')
  }

  getClient(): S3Client {
    if (this.client) return this.client

    this.client = new S3Client({
      region: this.config.get<string>('CLOUDFLARE_R2_REGION') || 'auto',
      endpoint: this.config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT'),
      forcePathStyle: this.config.get<boolean>('OBJECT_STORAGE_FORCE_PATH_STYLE') ?? false,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_KEY'),
      },
    })
    return this.client
  }

  private async bodyAsString(response: GetObjectCommandOutput): Promise<string> {
    if (!response.Body) return ''
    return response.Body.transformToString('utf-8')
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
    return candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
  }
}
