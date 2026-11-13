import { ForbiddenException } from '@nestjs/common'
import type { CompanyAccessContext } from './company-context.contracts'
import { portalDeniedMessage, portalKinds, type PortalKind } from './portal-access'

const clinical = ['ExamsController', 'PatientsController', 'PatientImportController', 'PatientReviewsController', 'ExamAttachmentsController', 'DicomViewerController', 'ResearchAiController', 'ResearchViewerController']
const management = ['CompanyMembershipsController', 'CompanySettingsController', 'CompaniesController', 'AccessControlController', 'HospitalUnitsController', 'PhysiciansController', 'PhysicianQualificationsController', 'ExamPricingController', 'RouterInstallerController']

const endpointPortals = (controller: string, method: string): readonly PortalKind[] => {
  if (controller === 'PhysicianSignatureController' || controller === 'UploadController') return portalKinds
  if (controller === 'CompanyMembershipsController' && ['own', 'preferences'].includes(method)) return portalKinds
  if (controller === 'CompanySettingsController' && method === 'get') return portalKinds
  if (controller === 'HospitalUnitsController' && method === 'list') return portalKinds
  if (controller === 'PhysiciansController' && method === 'listSpecialties') return portalKinds
  if (controller === 'PhysicianQualificationsController' && method === 'eligible') return ['sourad']
  if (controller === 'HospitalIntakesController' || controller === 'HospitalResultsController') return ['hospital']
  if (controller === 'HospitalReferralRoutesController') return method === 'list' ? ['hospital'] : ['configuracoes']
  if (controller === 'ReportLifecycleController') {
    if (['historyForVersion', 'version', 'activity'].includes(method)) return portalKinds
    if (method === 'review') return ['hospital', 'configuracoes']
    if (method === 'force') return ['sourad', 'configuracoes']
    if (method === 'authorize') return ['configuracoes']
    return ['sourad']
  }
  if (controller === 'ReportCompletionController') return method === 'get' ? ['sourad', 'configuracoes'] : ['sourad']
  if (controller === 'ExamsController' && method === 'list') return ['sourad', 'configuracoes']
  if (controller === 'ExamWorkflowController') {
    if (method === 'savePolicy') return ['configuracoes']
    if (method === 'policiesForUnit') return ['sourad', 'configuracoes']
    return ['sourad']
  }
  if (controller === 'DicomController') return ['images', 'complete', 'retryArchive'].includes(method) ? ['sourad'] : ['configuracoes']
  if (controller === 'ExamCatalogController') {
    if (['list', 'resolve'].includes(method)) return portalKinds
    return ['pending', 'classify'].includes(method) ? ['sourad'] : ['configuracoes']
  }
  if (controller === 'ContrastProtocolsController') return method === 'list' ? ['sourad', 'configuracoes'] : ['forExam', 'select'].includes(method) ? ['sourad'] : ['configuracoes']
  if (clinical.includes(controller)) return ['sourad']
  if (management.includes(controller)) return ['configuracoes']
  return [] // A new controller needs an explicit policy before it becomes accessible.
}

export const assertEndpointPortal = (controller: string, method: string, context: CompanyAccessContext) => {
  const allowed = context.isPlatformAdmin ? portalKinds : context.allowedPortals ?? []
  const candidates = context.portalKind ? allowed.filter(p => p === context.portalKind) : allowed
  const needsReview = (controller === 'ExamsController' && method === 'list') ||
    (controller === 'ReportCompletionController' && method === 'get') ||
    (controller === 'ReportLifecycleController' && ['historyForVersion', 'version', 'activity'].includes(method))
  const canReview = context.isPlatformAdmin || context.permissions.some(p => ['reports.review.request', 'reports.review.authorize'].includes(p))
  if (!candidates.some(p => endpointPortals(controller, method).includes(p) && (p !== 'configuracoes' || !needsReview || canReview))) {
    throw new ForbiddenException(portalDeniedMessage)
  }
}
