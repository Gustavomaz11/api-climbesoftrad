import { BadRequestException } from '@nestjs/common'
import type { ReportNode } from './exam-reports.service'
import type { R2ExamReportStorage } from './r2-exam-report-storage.service'

// Preserve report formatting, but never snapshot expiring URLs or external images.
export const completedContent = (content: ReportNode, examId: string): ReportNode => {
  let nodes = 0, text = ''
  const visit = (node: ReportNode, depth: number): ReportNode => {
    if (++nodes > 20000 || depth > 50 || !node || typeof node !== 'object')
      throw new BadRequestException('Estrutura do laudo inválida.')
    if (typeof node.text === 'string') text += node.text
    const result = { ...node }
    if (node.type === 'image') {
      const key = node.attrs?.storageKey
      if (typeof key !== 'string' || !new RegExp(`^reports/${examId}/images/[a-f0-9-]+\\.(png|jpg|gif|webp)$`).test(key))
        throw new BadRequestException('Utilize somente imagens anexadas a este laudo.')
      result.attrs = { ...node.attrs }
      delete result.attrs.src
    }
    if (node.content) {
      if (!Array.isArray(node.content)) throw new BadRequestException('Estrutura do laudo inválida.')
      result.content = node.content.map(child => visit(child, depth + 1))
    }
    return result
  }
  const result = visit(content, 0)
  if (content.type !== 'doc' || !text.trim()) throw new BadRequestException('Preencha o texto do laudo antes de finalizar.')
  return result
}

export const hydrateCompletedContent = async (node: ReportNode, storage: R2ExamReportStorage): Promise<ReportNode> => ({
  ...node,
  ...(node.type === 'image' ? { attrs: { ...node.attrs, src: await storage.signedImageUrl(String(node.attrs!.storageKey)) } } : {}),
  ...(node.content ? { content: await Promise.all(node.content.map(child => hydrateCompletedContent(child, storage))) } : {}),
})
