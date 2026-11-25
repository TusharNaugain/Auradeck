/**
 * The lead pipeline, in one place. Safe to import from client and server code.
 *
 * New (inbox) → 1 Contacted → 2 Interested → 3 Demo scheduled → 4 Demo attended
 * → 5 Signed up / trial → 6 Activated → 7 Paid → 8 Churned / paused.
 * "Dead" (LOST) sits outside the pipeline: people who never became customers.
 */

export const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'DEMO_SCHEDULED',
  'DEMO_ATTENDED',
  'SIGNED_UP',
  'ACTIVATED',
  'PAID',
  'CHURNED',
  'LOST',
] as const

export type LeadStage = (typeof LEAD_STAGES)[number]

export interface StageInfo {
  /** Pipeline step 1–8 from the sales playbook; null for the New inbox and Dead. */
  step: number | null
  label: string
  /** What being in this stage means. */
  meaning: string
  /** What the owner of the lead should do here. */
  todo: string
}

export const STAGE_INFO: Record<LeadStage, StageInfo> = {
  NEW: { step: null, label: 'New', meaning: 'Came in (sheet, form, import) — nobody has reached out yet.', todo: 'Reach out and move to Contacted.' },
  CONTACTED: { step: 1, label: 'Contacted', meaning: 'We reached out (LinkedIn, email, event, etc.).', todo: 'Log the source and date of the outreach.' },
  INTERESTED: { step: 2, label: 'Interested', meaning: 'Replied with real interest or asked a question.', todo: 'Move here when they engage; book a demo.' },
  DEMO_SCHEDULED: { step: 3, label: 'Demo scheduled', meaning: 'A demo time is booked.', todo: 'Confirm and send a reminder.' },
  DEMO_ATTENDED: { step: 4, label: 'Demo attended', meaning: 'They showed up and saw the product.', todo: 'Log outcome notes.' },
  SIGNED_UP: { step: 5, label: 'Signed up / trial', meaning: 'Account created / trial started.', todo: 'Onboarding sequence begins.' },
  ACTIVATED: { step: 6, label: 'Activated', meaning: 'Did a key action (added a client, session, note or invoice).', todo: 'Tracked from product analytics.' },
  PAID: { step: 7, label: 'Paid', meaning: 'Converted to a paid plan.', todo: 'Revenue is tracked.' },
  CHURNED: { step: 8, label: 'Churned / paused', meaning: 'Was a customer, then left or paused.', todo: 'Optional feedback form.' },
  LOST: { step: null, label: 'Dead', meaning: 'Not interested or not a fit — never became a customer.', todo: 'Nothing; stays under the “Dead” button.' },
}

/** Before sign-up: the sales part of the pipeline. */
export const PIPELINE_STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'DEMO_SCHEDULED', 'DEMO_ATTENDED'] as const satisfies readonly LeadStage[]
/** Signed up and still with us. */
export const CUSTOMER_STAGES = ['SIGNED_UP', 'ACTIVATED', 'PAID'] as const satisfies readonly LeadStage[]
/** Out of the funnel: churned customers and dead leads. */
export const CLOSED_STAGES = ['CHURNED', 'LOST'] as const satisfies readonly LeadStage[]
/** Dead leads are hidden from the board, the dashboard and campaign audiences. */
export const DEAD_LEAD_STAGES = ['LOST'] as const satisfies readonly LeadStage[]

/** Old stage names (before the 8-stage pipeline) → new stage. Mirrors migration 0008. */
export const LEGACY_STAGE_MAP: Record<string, LeadStage> = {
  QUALIFIED: 'INTERESTED',
  DEMO_BOOKED: 'DEMO_SCHEDULED',
  PROPOSAL_SENT: 'DEMO_ATTENDED',
  NEGOTIATION: 'DEMO_ATTENDED',
  CONVERTED: 'SIGNED_UP',
  DISQUALIFIED: 'LOST',
}

const ALIASES: Record<string, LeadStage> = {
  DEAD: 'LOST',
  NOT_INTERESTED: 'LOST',
  SIGNED_UP_TRIAL: 'SIGNED_UP',
  SIGNUP: 'SIGNED_UP',
  SIGNED_UP_OR_TRIAL: 'SIGNED_UP',
  TRIAL: 'SIGNED_UP',
  CHURNED_PAUSED: 'CHURNED',
  PAUSED: 'CHURNED',
  DEMO_BOOKED: 'DEMO_SCHEDULED',
  DEMO_DONE: 'DEMO_ATTENDED',
}

/**
 * Accepts a stage in any reasonable spelling — "Demo Scheduled", "signed up / trial",
 * "3. Demo Scheduled", legacy names like "qualified" — and returns the stage, or null.
 */
export function normalizeStage(input: unknown): LeadStage | null {
  if (typeof input !== 'string') return null
  const key = input
    .trim()
    .replace(/^\d+\s*[.)-]?\s*/, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!key) return null
  if ((LEAD_STAGES as readonly string[]).includes(key)) return key as LeadStage
  return LEGACY_STAGE_MAP[key] ?? ALIASES[key] ?? null
}

export function stageLabel(stage: string): string {
  return STAGE_INFO[stage as LeadStage]?.label ?? stage
}

/** "3 · Demo scheduled" for pipeline steps; plain label for New / Dead. */
export function stageTitle(stage: string): string {
  const info = STAGE_INFO[stage as LeadStage]
  if (!info) return stage
  return info.step ? `${info.step} · ${info.label}` : info.label
}

export function isStage(value: string, group: readonly LeadStage[]): boolean {
  return (group as readonly string[]).includes(value)
}
