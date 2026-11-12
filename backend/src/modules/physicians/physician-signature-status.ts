import type { EntityManager } from 'typeorm'

export const physicianNeedsSignature = async (manager: EntityManager, role: string, userId: string) => {
  if (role !== 'DOCTOR') return false
  const [row] = await manager.query<Array<{ ready: boolean }>>(
    'SELECT EXISTS(SELECT 1 FROM physicians WHERE user_id=$1 AND signature_image IS NOT NULL) AS ready', [userId],
  )
  return !row?.ready
}
