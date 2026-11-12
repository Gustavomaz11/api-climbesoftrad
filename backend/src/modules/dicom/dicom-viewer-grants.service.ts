import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import { DataSource, In } from 'typeorm'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { DicomViewerGrantEntity } from '../../database/entities/dicom-viewer-grant.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { UploadLiveContextService } from '../document-uploads/upload-live-context.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { DicomStudiesService } from './dicom-studies.service'
import { dicomTokenHash } from './dicom-sources.service'
import { HospitalDicomAccessService } from './hospital-dicom-access.service'
import { dicomViewerUrl } from './dicom-viewer-url'
@Injectable()
export class DicomViewerGrantsService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly live: UploadLiveContextService,
    private readonly access: ExamAccessService,
    private readonly studies: DicomStudiesService,
    private readonly audit: OperationalAuditService,
    private readonly hospital: HospitalDicomAccessService,
  ) {}
  get publicRoot() {
    return (this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000/api/v1').replace(
      /\/$/,
      '',
    )
  }
  async create(examId: string, previousId: string | undefined, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    if (previousId) await this.studies.comparison(examId, previousId, context)
    const records = await this.database.getRepository(DicomStudyEntity).findBy({
      companyId: context.companyId,
      examId: In([examId, ...(previousId ? [previousId] : [])]),
    })
    if (!records.length || (previousId && !records.some((x) => x.examId === previousId)))
      throw new NotFoundException('Imagens indisponíveis para o estudo selecionado.')
    const instances = await this.database
      .getRepository(DicomInstanceEntity)
      .findBy({ studyId: In(records.map((x) => x.id)) })
    if (instances.some((x) => !x.orthancId))
      throw new ConflictException(
        'Imagens aguardam disponibilização no visualizador. O download autorizado permanece disponível.',
      )
    const viewer = this.config.get<string>('OHIF_VIEWER_URL')
    if (!viewer) throw new ServiceUnavailableException('Visualizador não configurado.')
    const token = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + 15 * 60000)
    await this.database.transaction(async (manager) => {
      await manager.getRepository(DicomViewerGrantEntity).save({
        tokenHash: dicomTokenHash(token),
        context,
        studyIds: records.map((x) => x.id),
        expiresAt,
      })
      await this.audit.record(
        context,
        {
          action: 'DICOM_VIEWER_OPENED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: { studyCount: records.length },
        },
        manager,
      )
    })
    return { url: dicomViewerUrl(viewer, this.publicRoot, token, records.map(x => x.studyUid)), expiresAt }
  }
  async require(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Acesso temporário inválido.')
    const grant = await this.database
      .getRepository(DicomViewerGrantEntity)
      .findOneBy({ tokenHash: dicomTokenHash(token) })
    if (!grant || grant.expiresAt <= new Date())
      throw new UnauthorizedException('Acesso ao visualizador expirou. Abra novamente pelo Sourad.')
    const context = await this.live.user(grant.context)
    if (grant.intakeId) {
      const snapshot = await this.hospital.require(grant.intakeId, context, grant.uploadIds)
      const hospitalScope = this.hospital.scope(snapshot.intake, snapshot.files)
      return { grant, context, studies: hospitalScope.studies, hospitalScope }
    }
    if (
      !context.permissions.includes('exams.view') ||
      !context.permissions.includes('exams.viewer.open')
    )
      throw new ForbiddenException()
    const studies = await this.database
      .getRepository(DicomStudyEntity)
      .findBy({ id: In(grant.studyIds), companyId: context.companyId })
    for (const study of studies) await this.access.require(study.examId, context)
    return { grant, context, studies }
  }
  async configuration(token: string) {
    const scope=await this.require(token)
    const researchEnabled=!scope.grant.intakeId && scope.context.permissions.includes('research.ai.use')
      && this.config.get<boolean>('GEMINI_RESEARCH_ENABLED')===true
      && scope.context.companyId===this.config.get<string>('SOURAD_CENTRAL_COMPANY_ID')
    const root = `${this.publicRoot}/dicom-viewer/${token}/dicom-web`
    return {
      ...(researchEnabled?{souradResearch:{apiRoot:`${this.publicRoot}/dicom-viewer/${token}/research`,exams:scope.studies.filter((study):study is DicomStudyEntity=>'examId' in study).map(study=>({studyUid:study.studyUid,examId:(study as DicomStudyEntity).examId,
        url:`${(this.config.get<string>('SOURAD_WEB_URL') || 'http://localhost:5173').replace(/\/$/,'')}/research/exams/${(study as DicomStudyEntity).examId}`}))}}:{}),
      routerBasename: '/',
      showStudyList: false,
      useSharedArrayBuffer: 'FALSE',
      extensions: [],
      modes: [],
      defaultDataSourceName: 'sourad',
      dataSources: [
        {
          namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
          sourceName: 'sourad',
          configuration: {
            friendlyName: 'Sourad',
            name: 'sourad',
            qidoRoot: root,
            wadoRoot: root,
            wadoUriRoot: root,
            qidoSupportsIncludeField: true,
            imageRendering: 'wadors',
            thumbnailRendering: 'wadors',
            enableStudyLazyLoad: true,
            supportsFuzzyMatching: false,
            supportsWildcard: false,
            staticWado: true,
            singlepart: 'bulkdata',
          },
        },
      ],
    }
  }
}
