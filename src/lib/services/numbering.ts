/**
 * Tenant-safe serial number generation.
 * Uses a single atomic UPDATE ... RETURNING so two concurrent creates
 * in the same organisation never receive the same number (or cross organisations).
 */

import { db, Prisma } from '@/lib/db'

export type NumberEntity =
  | 'lead'
  | 'opportunity'
  | 'ticket'
  | 'invoice'
  | 'client'
  | 'account'
  | 'onboarding'
  | 'campaign'

const PREFIX: Record<NumberEntity, string> = {
  lead: 'LD',
  opportunity: 'OPP',
  ticket: 'TKT',
  invoice: 'INV',
  client: 'CL',
  account: 'ACC',
  onboarding: 'ONB',
  campaign: 'CMP',
}

const PAD = 6

/**
 * Get the next serial for an organisation + entity atomically.
 * Works with the root client or a Prisma transaction client so callers can
 * use it inside $transaction without risking two race-conditioned counters.
 */
export async function nextNumber(
  organisationId: string,
  entity: NumberEntity,
  tx?: Prisma.TransactionClient
): Promise<string> {
  const client = (tx ?? db) as typeof db
  const key = `${organisationId}:${entity}`
  const prefix = PREFIX[entity]

  const result = await client.$queryRaw<{ value: number }[]>`
    INSERT INTO number_counters ("key", "value", "updatedAt")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = number_counters."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `

  const value = result[0]?.value ?? 1
  return `${prefix}-${value.toString().padStart(PAD, '0')}`
}

/**
 * Numeric value only (no prefix). Used where the code is composed differently.
 */
export async function nextCounterValueInTx(
  organisationId: string,
  entity: NumberEntity,
  tx: Prisma.TransactionClient
): Promise<number> {
  const serial = await nextNumber(organisationId, entity, tx)
  return parseInt(serial.split('-')[1] ?? '1', 10)
}

/**
 * Seed the counter for an organisation+entity from existing max found in the
 * related table's serial column, so seeds/imports don't collide. Runs once per key.
 */
export async function ensureCounterSeeded(
  organisationId: string,
  entity: NumberEntity,
  existingCounts: Record<string, number>
): Promise<void> {
  const key = `${organisationId}:${entity}`
  const max = existingCounts[entity] ?? 0
  if (max <= 0) return
  await db.$executeRaw`
    INSERT INTO number_counters ("key", "value", "updatedAt")
    VALUES (${key}, ${max}, NOW())
    ON CONFLICT ("key") DO NOTHING
  `
}
