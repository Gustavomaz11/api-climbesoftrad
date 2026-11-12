import { canTransition, checklistSatisfied, type ChecklistEvidence } from './workflow.contracts'

describe('Operational workflow', () => {
  it('keeps presence separate and requires explicit authorized transitions', () => {
    expect(canTransition('TO_PREPARE', 'START', ['reports.edit'])).toBe(true)
    expect(canTransition('READY', 'START', ['reports.edit'])).toBe(true)
    expect(canTransition('READY', 'RELEASE', ['exams.prepare'])).toBe(false)
    expect(canTransition('CANCELLED', 'REOPEN', ['exams.prepare'])).toBe(false)
    expect(canTransition('SIGNED', 'CANCEL', ['exams.cancel'])).toBe(false)
    expect(canTransition('IN_PROGRESS', 'CANCEL', ['exams.view'])).toBe(false)
    expect(canTransition('TO_PREPARE', 'START', ['exams.prepare'])).toBe(false)
    expect(canTransition('PENDING', 'START', ['reports.edit'])).toBe(false)
    expect(canTransition('CANCELLED', 'START', ['reports.edit'])).toBe(false)
  })
  it('requires manual confirmation even when evidence is available', () => {
    const item: ChecklistEvidence = {
      item: 'IMAGES',
      available: true,
      evidenceIds: ['study'],
      confirmed: false,
      exceptionReason: null,
    }
    expect(checklistSatisfied([item])).toBe(false)
    expect(checklistSatisfied([{ ...item, confirmed: true }])).toBe(true)
  })
  it('only accepts missing evidence with a confirmed justified exception', () => {
    const item: ChecklistEvidence = {
      item: 'ORDER',
      available: false,
      evidenceIds: [],
      confirmed: true,
      exceptionReason: null,
    }
    expect(checklistSatisfied([item])).toBe(false)
    expect(checklistSatisfied([{ ...item, exceptionReason: ' ' }])).toBe(false)
    expect(checklistSatisfied([{ ...item, exceptionReason: 'Autorização registrada' }])).toBe(true)
  })
})
