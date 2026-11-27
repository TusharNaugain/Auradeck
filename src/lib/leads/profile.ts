/**
 * The therapist record: every fact about one therapist lives on their lead, grouped the way the
 * team reads it (identity → acquisition → … → outcome). Safe to import from client and server code.
 */

export const DEMO_STATUSES = ['not_booked', 'scheduled', 'attended', 'no_show', 'cancelled'] as const
export const WILLINGNESS_TO_PAY = ['high', 'medium', 'low', 'not_willing', 'unknown'] as const
export const PAYMENT_STATUSES = ['not_started', 'pending', 'paid', 'failed', 'refunded'] as const
export const OUTCOMES = ['open', 'paid', 'dormant', 'lost'] as const

export type DemoStatus = (typeof DEMO_STATUSES)[number]
export type Outcome = (typeof OUTCOMES)[number]

export const OPTION_LABELS: Record<string, string> = {
  not_booked: 'Not booked',
  scheduled: 'Scheduled',
  attended: 'Attended',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_willing: 'Not willing',
  unknown: 'Not sure yet',
  not_started: 'Not started',
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  open: 'Still open',
  dormant: 'Dormant',
  lost: 'Lost',
}

export const optionLabel = (value: string | null | undefined) => (value ? OPTION_LABELS[value] ?? value : null)

/** Profile fields the team edits on the lead (columns on `leads`). */
export const PROFILE_DATE_FIELDS = [
  'signedUpAt', 'demoAt', 'firstLoginAt', 'firstClientAt', 'firstSessionAt', 'lastActiveAt', 'trialStartAt', 'trialEndsAt',
] as const
export const PROFILE_TEXT_FIELDS = ['planOffered', 'objections', 'featureRequests', 'lostReason'] as const

type StageDefaults = Partial<{
  signedUpAt: Date
  trialStartAt: Date
  demoStatus: DemoStatus
  paymentStatus: (typeof PAYMENT_STATUSES)[number]
  outcome: Outcome
}>

/**
 * Fields a stage move fills in, only where the team has not set them already, so the record keeps
 * up with the pipeline without overwriting anything typed by hand.
 */
export function profileDefaultsForStage(
  stage: string,
  current: { signedUpAt?: Date | null; trialStartAt?: Date | null; demoStatus?: string | null; paymentStatus?: string | null; outcome?: string | null },
  now = new Date()
): StageDefaults {
  const out: StageDefaults = {}
  switch (stage) {
    case 'DEMO_SCHEDULED':
      if (!current.demoStatus || current.demoStatus === 'not_booked') out.demoStatus = 'scheduled'
      break
    case 'DEMO_ATTENDED':
      if (current.demoStatus !== 'attended') out.demoStatus = 'attended'
      break
    case 'SIGNED_UP':
    case 'ACTIVATED':
      if (!current.signedUpAt) out.signedUpAt = now
      if (stage === 'SIGNED_UP' && !current.trialStartAt) out.trialStartAt = now
      break
    case 'PAID':
      if (!current.signedUpAt) out.signedUpAt = now
      if (current.paymentStatus !== 'paid') out.paymentStatus = 'paid'
      if (current.outcome !== 'paid') out.outcome = 'paid'
      break
    case 'CHURNED':
    case 'LOST':
      if (current.outcome !== 'lost') out.outcome = 'lost'
      break
  }
  return out
}
