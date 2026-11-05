import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export function leadScope(
  scopeType: string,
  userId: string,
  teamId: string | null,
  teamMemberIds: string[]
): Prisma.LeadWhereInput {
  if (scopeType === 'OWN') {
    return { OR: [{ assignedToUserId: userId }, { createdBy: userId }] }
  }
  if (scopeType === 'ASSIGNED') return { assignedToUserId: userId }
  if (scopeType === 'TEAM') {
    if (!teamId) return { id: { in: [] } }
    return {
      OR: [
        { assignedTeamId: teamId },
        { assignedToUserId: { in: teamMemberIds } },
        { createdBy: { in: teamMemberIds } },
      ],
    }
  }
  return {}
}

export function opportunityScope(
  scopeType: string,
  userId: string,
  teamId: string | null,
  teamMemberIds: string[]
): Prisma.OpportunityWhereInput {
  if (scopeType === 'OWN' || scopeType === 'ASSIGNED') {
    return { ownerUserId: userId }
  }
  if (scopeType === 'TEAM') {
    if (!teamId) return { id: { in: [] } }
    return {
      OR: [
        { teamId },
        { ownerUserId: { in: teamMemberIds } },
      ],
    }
  }
  return {}
}

export async function resolveLeadScope(
  organisationId: string,
  scopeType: string,
  userId: string,
  teamId: string | null
): Promise<Prisma.LeadWhereInput> {
  if (scopeType !== 'TEAM') return leadScope(scopeType, userId, teamId, [])
  if (!teamId) return leadScope(scopeType, userId, teamId, [])

  const memberships = await db.membership.findMany({
    where: { organisationId, teamId, status: 'ACTIVE' },
    select: { userId: true },
  })
  return leadScope(scopeType, userId, teamId, memberships.map(({ userId: memberId }) => memberId))
}
