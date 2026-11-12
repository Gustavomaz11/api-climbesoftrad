import type { PermissionCode } from '../access-control/permission.catalog'

export const workflowStates = [
  'TO_PREPARE',
  'READY',
  'IN_PROGRESS',
  'TYPED',
  'SIGNED',
  'PENDING',
  'RECALLED',
  'CANCELLED',
] as const
export type WorkflowState = (typeof workflowStates)[number]
export const preparationItems = ['ORDER', 'QUESTIONNAIRE', 'IMAGES', 'COMPARATIVE'] as const
export type PreparationItem = (typeof preparationItems)[number]
export type WorkflowAction = 'RELEASE' | 'START' | 'REOPEN' | 'CANCEL'

export const transitionRules: Record<
  WorkflowAction,
  { from: readonly WorkflowState[]; to: WorkflowState; permission: PermissionCode }
> = {
  RELEASE: { from: ['TO_PREPARE'], to: 'READY', permission: 'exams.prepare' },
  START: { from: ['TO_PREPARE', 'READY'], to: 'IN_PROGRESS', permission: 'reports.edit' },
  REOPEN: {
    from: ['READY', 'IN_PROGRESS', 'TYPED'],
    to: 'TO_PREPARE',
    permission: 'exams.prepare',
  },
  CANCEL: {
    from: ['TO_PREPARE', 'READY', 'IN_PROGRESS', 'TYPED', 'PENDING', 'RECALLED'],
    to: 'CANCELLED',
    permission: 'exams.cancel',
  },
}

export const canTransition = (
  state: WorkflowState,
  action: WorkflowAction,
  permissions: readonly string[],
) =>
  transitionRules[action].from.includes(state) &&
  permissions.includes(transitionRules[action].permission)

export interface ChecklistEvidence {
  item: PreparationItem
  available: boolean
  evidenceIds: string[]
  confirmed: boolean
  exceptionReason: string | null
}

export const checklistSatisfied = (items: ChecklistEvidence[]) =>
  items.every((item) => item.confirmed && (item.available || Boolean(item.exceptionReason?.trim())))

export interface WorkflowIssue {
  id: string
  company_id: string
  unit_id: string
  exam_id: string
  kind: 'PENDING' | 'RECALL'
  category: string
  reason: string
  requested_action: 'ACQUISITION' | 'DOCUMENTS' | null
  responsible_user_id: string | null
  phase: 'PREPARATION' | 'REPORTING'
  attachment_ids: string[]
  comment_ids: string[]
  opened_at: Date
  resolved_at: Date | null
}
