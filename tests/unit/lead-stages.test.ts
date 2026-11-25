import { describe, expect, it } from 'vitest'
import {
  CLOSED_STAGES, CUSTOMER_STAGES, LEAD_STAGES, LEGACY_STAGE_MAP, PIPELINE_STAGES, STAGE_INFO, normalizeStage, stageTitle,
} from '@/lib/leads/stages'
import { addExtraContact, lockedSourceFields, parseExtraContacts, removeExtraContact, MAX_EXTRA_CONTACTS } from '@/lib/leads/extra-contacts'

describe('lead pipeline stages', () => {
  it('has the 8 playbook steps in order, plus the New inbox and Dead', () => {
    const steps = LEAD_STAGES.filter((s) => STAGE_INFO[s].step).map((s) => [STAGE_INFO[s].step, s])
    expect(steps).toEqual([
      [1, 'CONTACTED'], [2, 'INTERESTED'], [3, 'DEMO_SCHEDULED'], [4, 'DEMO_ATTENDED'],
      [5, 'SIGNED_UP'], [6, 'ACTIVATED'], [7, 'PAID'], [8, 'CHURNED'],
    ])
    expect(STAGE_INFO.NEW.step).toBeNull()
    expect(STAGE_INFO.LOST.label).toBe('Dead')
  })

  it('gives every stage a meaning and a to-do', () => {
    for (const stage of LEAD_STAGES) {
      expect(STAGE_INFO[stage].meaning.length).toBeGreaterThan(5)
      expect(STAGE_INFO[stage].todo.length).toBeGreaterThan(3)
    }
  })

  it('splits every stage into exactly one tab group', () => {
    const grouped = [...PIPELINE_STAGES, ...CUSTOMER_STAGES, ...CLOSED_STAGES]
    expect([...grouped].sort()).toEqual([...LEAD_STAGES].sort())
  })

  it('maps every pre-pipeline stage (migration 0008) to a current stage', () => {
    expect(LEGACY_STAGE_MAP).toEqual({
      QUALIFIED: 'INTERESTED',
      DEMO_BOOKED: 'DEMO_SCHEDULED',
      PROPOSAL_SENT: 'DEMO_ATTENDED',
      NEGOTIATION: 'DEMO_ATTENDED',
      CONVERTED: 'SIGNED_UP',
      DISQUALIFIED: 'LOST',
    })
    for (const target of Object.values(LEGACY_STAGE_MAP)) expect(LEAD_STAGES).toContain(target)
  })

  it('normalises sheet labels, numbered labels and legacy names', () => {
    expect(normalizeStage('3. Demo Scheduled')).toBe('DEMO_SCHEDULED')
    expect(normalizeStage('Signed Up / Trial')).toBe('SIGNED_UP')
    expect(normalizeStage('8. Churned / Paused')).toBe('CHURNED')
    expect(normalizeStage('demo attended')).toBe('DEMO_ATTENDED')
    expect(normalizeStage('Dead')).toBe('LOST')
    expect(normalizeStage('converted')).toBe('SIGNED_UP')
    expect(normalizeStage('negotiation')).toBe('DEMO_ATTENDED')
    expect(normalizeStage('banana')).toBeNull()
    expect(normalizeStage('')).toBeNull()
    expect(normalizeStage(42)).toBeNull()
  })

  it('titles pipeline steps with their number', () => {
    expect(stageTitle('DEMO_SCHEDULED')).toBe('3 · Demo scheduled')
    expect(stageTitle('NEW')).toBe('New')
    expect(stageTitle('LOST')).toBe('Dead')
  })
})

describe('extra contacts', () => {
  const lead = { email: 'asha@clinic.in', phoneNumber: '+919876543210', alternatePhone: null, whatsappNumber: null }

  it('locks source email and phone once set, but allows filling a blank one or re-sending the same value', () => {
    expect(lockedSourceFields(lead, { email: 'other@clinic.in' })).toEqual(['Email'])
    expect(lockedSourceFields(lead, { phone: '+91 99999 00000' })).toEqual(['Phone'])
    expect(lockedSourceFields(lead, { email: ' ASHA@clinic.in ', phone: '+91 98765-43210' })).toEqual([])
    expect(lockedSourceFields(lead, { alternatePhone: '+919000000000' })).toEqual([])
    expect(lockedSourceFields(lead, { email: null })).toEqual(['Email'])
    expect(lockedSourceFields(lead, { firstName: 'Asha' })).toEqual([])
  })

  it('adds contacts with canonical values and rejects duplicates', () => {
    const one = addExtraContact([], { type: 'phone', value: '+91 98765 11111', label: 'Clinic' }, 'u1', new Date('2026-11-25T00:00:00Z'))
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ type: 'phone', value: '+919876511111', label: 'Clinic', addedBy: 'u1', addedAt: '2026-11-25T00:00:00.000Z' })
    expect(() => addExtraContact(one, { type: 'phone', value: '+91-98765-11111' }, 'u2')).toThrow(/already/)
    const two = addExtraContact(one, { type: 'linkedin', value: 'linkedin.com/in/asha' }, 'u1')
    expect(two.map((c) => c.type)).toEqual(['phone', 'linkedin'])
  })

  it('caps the number of extra contacts', () => {
    let list = parseExtraContacts([])
    for (let i = 0; i < MAX_EXTRA_CONTACTS; i++) list = addExtraContact(list, { type: 'other', value: `c${i}` }, 'u1')
    expect(() => addExtraContact(list, { type: 'other', value: 'one more' }, 'u1')).toThrow(/at most/)
  })

  it('removes by id and ignores malformed stored values', () => {
    const list = addExtraContact([], { type: 'instagram', value: '@asha' }, 'u1')
    expect(removeExtraContact(list, list[0].id)).toEqual([])
    expect(() => removeExtraContact(list, 'nope')).toThrow(/not found/)
    expect(parseExtraContacts([{ id: 'x', type: 'phone', value: '1' }, { bad: true }, null, 'str'])).toHaveLength(1)
    expect(parseExtraContacts({})).toEqual([])
  })
})
