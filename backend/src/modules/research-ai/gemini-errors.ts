export const retryableResearchErrors = new Set([
  'GEMINI_UNAVAILABLE',
  'GEMINI_TIMEOUT',
  'GEMINI_NETWORK_ERROR',
  'GEMINI_TLS_ERROR',
  'GEMINI_TEMPORARILY_UNAVAILABLE',
  'GEMINI_QUOTA_EXCEEDED',
  'PROCESS_INTERRUPTED',
])
export const geminiHttpError = (status: number) => {
  if (status === 429) return 'GEMINI_QUOTA_EXCEEDED'
  if ([500, 502, 503, 504].includes(status)) return 'GEMINI_TEMPORARILY_UNAVAILABLE'
  if (status === 401 || status === 403) return 'GEMINI_ACCESS_DENIED'
  return 'GEMINI_REQUEST_REJECTED'
}
export const geminiNetworkError = (error: unknown): string => {
  const value = error as { name?: string; code?: string; cause?: unknown } | null
  if (value?.name === 'TimeoutError' || value?.name === 'AbortError') return 'GEMINI_TIMEOUT'
  if (
    value?.code &&
    [
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(value.code)
  )
    return 'GEMINI_TIMEOUT'
  if (
    value?.code &&
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(value.code)
  )
    return 'GEMINI_TLS_ERROR'
  return value?.cause ? geminiNetworkError(value.cause) : 'GEMINI_NETWORK_ERROR'
}
