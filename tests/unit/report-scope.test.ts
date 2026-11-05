import { describe, expect, it } from 'vitest'
import { leadScope, opportunityScope } from '@/lib/reports/scope'

describe('overview report record scopes', () => {
  it('limits own-scope leads to assigned or created records', () => {
    expect(leadScope('OWN', 'user-1', null, [])).toEqual({
      OR: [{ assignedToUserId: 'user-1' }, { createdBy: 'user-1' }],
    })
  })

  it('limits assigned-scope records to the current user', () => {
    expect(leadScope('ASSIGNED', 'user-1', null, [])).toEqual({ assignedToUserId: 'user-1' })
    expect(opportunityScope('ASSIGNED', 'user-1', null, [])).toEqual({ ownerUserId: 'user-1' })
  })

  it('includes team-tagged and active-member records for team scope', () => {
    expect(leadScope('TEAM', 'user-1', 'team-1', ['user-1', 'user-2'])).toEqual({
      OR: [
        { assignedTeamId: 'team-1' },
        { assignedToUserId: { in: ['user-1', 'user-2'] } },
        { createdBy: { in: ['user-1', 'user-2'] } },
      ],
    })
    expect(opportunityScope('TEAM', 'user-1', 'team-1', ['user-1', 'user-2'])).toEqual({
      OR: [
        { teamId: 'team-1' },
        { ownerUserId: { in: ['user-1', 'user-2'] } },
      ],
    })
  })

  it('fails closed when team scope has no team assigned', () => {
    expect(leadScope('TEAM', 'user-1', null, [])).toEqual({ id: { in: [] } })
    expect(opportunityScope('TEAM', 'user-1', null, [])).toEqual({ id: { in: [] } })
  })

  it('leaves organisation scope unfiltered', () => {
    expect(leadScope('ORGANISATION', 'user-1', null, [])).toEqual({})
    expect(opportunityScope('ORGANISATION', 'user-1', null, [])).toEqual({})
  })
})
