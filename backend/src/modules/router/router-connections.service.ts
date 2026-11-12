import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
export interface RouterConnection { status: 'ONLINE' | 'OFFLINE'; installed: number; lastSeenAt: Date | null }

@Injectable()
export class RouterConnectionsService {
  constructor(private readonly db: DataSource) {}
  async forUnits(companyId: string, ids: string[]): Promise<Map<string, RouterConnection>> {
    if (!ids.length) return new Map<string, RouterConnection>()
    const rows = await this.db.query<Array<{ unit_id: string; installed: number; online: boolean; last_seen_at: Date | null }>>(`
      SELECT r.unit_id,count(*)::int AS installed,
        bool_or(s.active AND u.active AND s.last_seen_at>now()-interval '60 seconds') AS online,
        max(s.last_seen_at) AS last_seen_at FROM router_installations r
        JOIN dicom_sources s ON s.id=r.source_id JOIN hospital_units u ON u.id=r.unit_id
        WHERE r.company_id=$1 AND r.unit_id=ANY($2::uuid[]) GROUP BY r.unit_id`, [companyId, ids])
    const result = new Map<string, RouterConnection>()
    for (const row of rows) result.set(row.unit_id, { status: row.online ? 'ONLINE' : 'OFFLINE', installed: row.installed, lastSeenAt: row.last_seen_at })
    return result
  }
}
