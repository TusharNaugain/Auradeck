'use client'

/**
 * Lead owner control in the lead details sheet. People with leads.assign pick an owner
 * from the active team; everyone else just sees who owns the lead. The API enforces the
 * same rule (and that the owner is an active member).
 */

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/client/api'
import { errorMessage, useHasPermission, useInvalidate } from '@/lib/client/hooks'

interface Member { userId: string; user: { fullName: string }; role: { name: string } }

export function LeadOwner({ leadId, owner }: { leadId: string; owner: { id: string; fullName: string } | null }) {
  const canAssign = useHasPermission('leads.assign')
  const canSeeMembers = useHasPermission('users.view')
  const invalidate = useInvalidate()
  const [saving, setSaving] = React.useState(false)
  const members = useQuery({
    queryKey: ['users', 'assignees'],
    queryFn: () => api.get<{ items: Member[] }>('/api/users', { pageSize: 100 }),
    enabled: canAssign && canSeeMembers,
    staleTime: 60_000,
  })

  if (!canAssign || !canSeeMembers) {
    return owner
      ? <Badge variant="secondary"><UserRound className="mr-1 size-3" />{owner.fullName}</Badge>
      : <Badge variant="outline">Unassigned</Badge>
  }

  async function assign(value: string) {
    setSaving(true)
    try {
      await api.patch(`/api/leads/${leadId}`, { assignedToUserId: value === 'none' ? null : value })
      const name = members.data?.items.find(m => m.userId === value)?.user.fullName
      toast.success(name ? `Assigned to ${name}` : 'Lead unassigned')
      invalidate(['lead', leadId], ['leads'], ['reports', 'overview'])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const options = members.data?.items ?? []
  const ownerListed = !owner || options.some(m => m.userId === owner.id)
  return (
    <Select value={owner?.id ?? 'none'} onValueChange={assign} disabled={saving}>
      <SelectTrigger className="h-6 w-auto gap-1 rounded-full px-2 text-xs" aria-label="Lead owner">
        <UserRound className="size-3" />
        <SelectValue placeholder="Assign owner" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {!ownerListed && owner && <SelectItem value={owner.id}>{owner.fullName}</SelectItem>}
        {options.map(m => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.user.fullName} <span className="text-muted-foreground">· {m.role.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
