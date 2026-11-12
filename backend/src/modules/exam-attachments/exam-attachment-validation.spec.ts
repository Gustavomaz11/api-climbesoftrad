import { validate } from 'class-validator'
import type { DataSource } from 'typeorm'
import { UploadExamAttachmentDto } from './exam-attachment.dto'
import { ExamAttachmentReaderService } from './exam-attachment-reader.service'
import type { ExamAccessService } from '../exams/exam-access.service'
import type { R2ObjectStorage } from '../exams/r2-object-storage.service'
import type { OperationalAuditService } from '../companies/operational-audit.service'
import { companyTestContext } from '../../../test/company-test-context'
describe('Attachment categories and approval gate',()=>{
  it('accepts only supported categories and rejects invalid replacement versions',async()=>{
    for(const category of ['ORDER','QUESTIONNAIRE','COMPARATIVE'])expect(await validate(Object.assign(new UploadExamAttachmentDto(),{category}))).toEqual([])
    expect((await validate(Object.assign(new UploadExamAttachmentDto(),{category:'OTHER'}))).length).toBeGreaterThan(0)
    expect((await validate(Object.assign(new UploadExamAttachmentDto(),{category:'ORDER',expectedVersion:0}))).length).toBeGreaterThan(0)
  })
  it('never emits access for a legacy, quarantined or rejected attachment',async()=>{
    const record={object:{status:'STORED'},validationStatus:'SIGNATURE_VALIDATED'}
    const database={getRepository:()=>({findOne:()=>Promise.resolve(record)})}
    const access={require:()=>Promise.resolve({unitId:'unit'})},objects={signedGetUrl:jest.fn()},audit={external:jest.fn()}
    const reader=new ExamAttachmentReaderService(database as unknown as DataSource,access as unknown as ExamAccessService,objects as unknown as R2ObjectStorage,audit as unknown as OperationalAuditService)
    for(const status of ['SIGNATURE_VALIDATED','QUARANTINED','REJECTED']){
      record.validationStatus=status
      await expect(reader.open('exam','attachment',companyTestContext)).rejects.toThrow('conferência')
    }
    expect(objects.signedGetUrl).not.toHaveBeenCalled()
  })
})
