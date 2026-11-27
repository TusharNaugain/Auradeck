import { describe, expect, it } from 'vitest'
import { profileDefaultsForStage } from '@/lib/leads/profile'

const now = new Date('2026-11-27T10:00:00Z')

describe('profileDefaultsForStage', () => {
  it('marks the demo scheduled, then attended', () => {
    expect(profileDefaultsForStage('DEMO_SCHEDULED', {}, now)).toEqual({ demoStatus: 'scheduled' })
    expect(profileDefaultsForStage('DEMO_SCHEDULED', { demoStatus: 'no_show' }, now)).toEqual({})
    expect(profileDefaultsForStage('DEMO_ATTENDED', { demoStatus: 'scheduled' }, now)).toEqual({ demoStatus: 'attended' })
  })

  it('records signup and trial start once', () => {
    expect(profileDefaultsForStage('SIGNED_UP', {}, now)).toEqual({ signedUpAt: now, trialStartAt: now })
    const earlier = new Date('2026-11-01')
    expect(profileDefaultsForStage('SIGNED_UP', { signedUpAt: earlier, trialStartAt: earlier }, now)).toEqual({})
    expect(profileDefaultsForStage('ACTIVATED', {}, now)).toEqual({ signedUpAt: now })
  })

  it('sets paid and lost outcomes', () => {
    expect(profileDefaultsForStage('PAID', {}, now)).toEqual({ signedUpAt: now, paymentStatus: 'paid', outcome: 'paid' })
    expect(profileDefaultsForStage('CHURNED', { outcome: 'paid' }, now)).toEqual({ outcome: 'lost' })
    expect(profileDefaultsForStage('LOST', { outcome: 'lost' }, now)).toEqual({})
  })

  it('leaves early stages alone', () => {
    expect(profileDefaultsForStage('CONTACTED', {}, now)).toEqual({})
  })
})
