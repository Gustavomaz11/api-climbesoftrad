export function documentAvailability(
  body: string | null | undefined,
  examId: string,
  prescription = false,
): string {
  if (body === undefined) return 'NOT_AUTHORIZED'
  if (!body) return 'UNAVAILABLE'
  try {
    const parsed: unknown = JSON.parse(body)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('examId' in parsed) ||
      parsed.examId !== examId ||
      !('content' in parsed) ||
      !parsed.content ||
      typeof parsed.content !== 'object'
    )
      return 'RECOVERY_REQUIRED'
    return prescription && 'signature' in parsed && Boolean(parsed.signature)
      ? 'SIGNED_VISUAL_AVAILABLE'
      : 'DRAFT_AVAILABLE'
  } catch {
    return 'RECOVERY_REQUIRED'
  }
}
