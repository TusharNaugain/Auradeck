/**
 * Append-only audit log writer.
 * Every security-relevant event is recorded here.
 * Logs are never deleted by normal application code.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/utils/logger'

interface AuditLogParams {
  organisationId?: string
  actorUserId?: string
  actorType?: string
  action: string
  resourceType: string
  resourceId?: string
  requestId?: string
  /** Convenience aliases also accepted */
  ipHash?: string
  userAgentHash?: string
  ipAddressHash?: string
  beforeJson?: Record<string, unknown>
  afterJson?: Record<string, unknown>
  reason?: string
}

/**
 * Redact sensitive fields from before/after JSON.
 * These fields are never stored in audit logs.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'secret',
  'token',
  'tokenHash',
  'creditCard',
  'cvv',
  'bankAccount',
  'taxNumber',
  'dateOfBirth',
  'emergencyContactPhone',
])

function redactJson(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj) return undefined

  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key)) {
      redacted[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redacted[key] = redactJson(value as Record<string, unknown>)
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

/**
 * Create an audit log entry.
 * This is a fire-and-forget operation; errors are logged but not thrown.
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organisationId: params.organisationId,
        actorUserId: params.actorUserId,
        actorType: params.actorType ?? 'user',
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        requestId: params.requestId,
        ipAddressHash: params.ipAddressHash ?? params.ipHash,
        userAgentHash: params.userAgentHash,
        beforeJson: (redactJson(params.beforeJson) ?? undefined) as never,
        afterJson: (redactJson(params.afterJson) ?? undefined) as never,
        reason: params.reason,
      },
    })
  } catch (error) {
    // Audit log failure must not break the application
    logger.error('Failed to create audit log', { error, params })
  }
}

/**
 * Create an audit log for a data mutation (before/after comparison).
 */
export async function auditMutation<T extends Record<string, unknown>>(params: {
  organisationId?: string
  actorUserId?: string
  action: string
  resourceType: string
  resourceId?: string
  requestId?: string
  before?: T
  after?: T
}): Promise<void> {
  return createAuditLog({
    ...params,
    beforeJson: params.before,
    afterJson: params.after,
  })
}
