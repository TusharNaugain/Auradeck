/**
 * Utility logging for invitations (generically logged, no secret tokens).
 */

import { logger } from '@/lib/utils/logger'

export async function logInvite(params: { email: string; organisationId: string }): Promise<void> {
  logger.info('Invitation generated and emailed', {
    email: params.email,
    organisationId: params.organisationId,
  })
}
