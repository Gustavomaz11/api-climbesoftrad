import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { DicomSeriesEntity } from '../../database/entities/dicom-series.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { DicomViewerGrantsService } from './dicom-viewer-grants.service'
import { OrthancArchiveService } from './orthanc-archive.service'
type DicomJson = Record<string, { vr: string; Value?: unknown[]; BulkDataURI?: string }>
const dicomUid = (row: DicomJson, key: string) => {
  const value = row[key]?.Value?.[0]
  return typeof value === 'string' ? value : ''
}
@Injectable()
export class DicomwebProxyService {
  constructor(
    private readonly database: DataSource,
    private readonly grants: DicomViewerGrantsService,
    private readonly archive: OrthancArchiveService,
  ) {}
  async request(
    token: string,
    path: string,
    accept: string | undefined,
    query: Record<string, unknown>,
  ) {
    const { studies, hospitalScope } = await this.grants.require(token)
    const allowed = [
      /^studies$/,
      /^studies\/[0-9.]+\/series$/,
      /^studies\/[0-9.]+\/series\/[0-9.]+\/instances$/,
      /^studies\/[0-9.]+(?:\/series\/[0-9.]+(?:\/instances\/[0-9.]+)?)?\/metadata$/,
      /^studies\/[0-9.]+\/series\/[0-9.]+\/instances\/[0-9.]+\/(?:frames\/[0-9,]+|bulk\/[a-zA-Z0-9]+)$/,
    ]
    if (!allowed.some((pattern) => pattern.test(path)))
      throw new BadRequestException('Recurso DICOMweb não permitido.')
    const segments = path.split('/'),
      studyUid = segments[1]
    if (studyUid && !studies.some((x) => x.studyUid === studyUid)) throw new ForbiddenException()
    const selected = studyUid ? studies.filter((x) => x.studyUid === studyUid) : studies
    const series = hospitalScope?.series ?? await this.database
      .getRepository(DicomSeriesEntity)
      .findBy({ studyId: In(selected.map((x) => x.id)) })
    const instances = hospitalScope?.instances ?? await this.database
      .getRepository(DicomInstanceEntity)
      .findBy({ studyId: In(selected.map((x) => x.id)) })
    if (segments[3] && !series.some((x) => x.seriesUid === segments[3]))
      throw new ForbiddenException()
    if (
      segments[5] &&
      !instances.some(
        (x) =>
          x.instanceUid === segments[5] &&
          series.find((s) => s.id === x.seriesId)?.seriesUid === segments[3],
      )
    )
      throw new ForbiddenException()
    const binary = segments[6] === 'frames' || segments[6] === 'bulk'
    if (binary)
      return {
        binary: true as const,
        response: await this.archive.request('/dicom-web/' + path, {
          headers: { Accept: accept || 'multipart/related; type="application/octet-stream"' },
        }),
      }
    // Never relay a whole-study binary response: Orthanc UIDs may be shared by independent scopes.
    const filter = query.StudyInstanceUID
    if (filter && (typeof filter !== 'string' || !selected.some((x) => x.studyUid === filter)))
      throw new ForbiddenException()
    const paths =
      path === 'studies'
        ? selected
            .filter((x) => !filter || x.studyUid === filter)
            .map((x) => `studies?StudyInstanceUID=${x.studyUid}`)
        : [path]
    const rows: DicomJson[] = []
    for (const scopedPath of paths) {
      const response = await this.archive.request('/dicom-web/' + scopedPath, {
        headers: { Accept: 'application/dicom+json' },
      })
      const data = (await response.json()) as DicomJson[]
      if (!Array.isArray(data)) throw new BadRequestException('Resposta DICOMweb inválida.')
      for (const row of data) {
        const sop = dicomUid(row, '00080018'),
          seriesUid = dicomUid(row, '0020000E'),
          uid = dicomUid(row, '0020000D')
        if (
          sop
            ? !instances.some((x) => x.instanceUid === sop)
            : seriesUid
              ? !series.some((x) => x.seriesUid === seriesUid)
              : !selected.some((x) => x.studyUid === uid)
        )
          continue
        rows.push(this.rewrite(row, token))
      }
    }
    return { binary: false as const, rows }
  }
  private rewrite(row: DicomJson, token: string) {
    const root = `${this.grants.publicRoot}/dicom-viewer/${token}/dicom-web/`
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk)
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (key === 'BulkDataURI' && typeof item === 'string') {
            const path = item.split('/dicom-web/')[1]
            return [key, path ? root + path : '']
          }
          return [key, walk(item)]
        }),
      )
    }
    return walk(row) as DicomJson
  }
}
