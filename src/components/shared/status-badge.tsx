import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'
import { enumLabel } from '@/lib/client/format'

const TONE_BY_TOKEN: Record<string, string> = {
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  blue: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-red-500/12 text-red-700 dark:text-red-400',
  grey: 'bg-muted text-muted-foreground',
}

const STATUS_TONE: Record<string, keyof typeof TONE_BY_TOKEN> = {
  new: 'blue', contacted: 'blue', qualified: 'blue', engaged: 'blue', assigned: 'blue',
  in_progress: 'amber', open: 'amber', pending: 'amber', draft: 'grey', invited: 'amber',
  active: 'green', won: 'green', converted: 'green', resolved: 'green', closed: 'green',
  completed: 'green', paid: 'green', delivered: 'green', healthy: 'green', verified: 'green',
  published: 'green', approved: 'green', on_track: 'green', success: 'green',
  lost: 'grey', cancelled: 'grey', expired: 'grey', abandoned: 'grey', suppressed: 'grey',
  info: 'blue',
  at_risk: 'amber', watch: 'amber', partially_paid: 'amber', overdue: 'red', breached: 'red',
  warning: 'amber',
  critical: 'red', failed: 'red', suspended: 'red', deactivated: 'red', unhealthy: 'red',
  error: 'red',
  draft_only: 'grey', unknown: 'grey',
}

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const tone = STATUS_TONE[value.toLowerCase()] ?? 'grey'
  return (
    <Badge variant="outline" className={cn('border-transparent font-medium', TONE_BY_TOKEN[tone], className)}>
      {enumLabel(value)}
    </Badge>
  )
}
