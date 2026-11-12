import { Module } from '@nestjs/common'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { ClamAvScanner } from './clamav-scanner.service'
import { R2MultipartStorage } from './r2-multipart-storage.service'
import { FileValidationService } from './file-validation.service'
@Module({
  providers: [R2ObjectStorage, R2MultipartStorage, ClamAvScanner, FileValidationService],
  exports: [R2MultipartStorage, FileValidationService],
})
export class FileValidationModule {}
