/**
 * Production bootstrap: RBAC catalogue, internal organisation, one admin user.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com tsx src/lib/db/bootstrap.ts
 *
 * Idempotent: everything is looked up before it is created; nothing is deleted
 * or overwritten. The admin is created WITHOUT a password — they sign in with
 * Google (or use "Forgot password" to set one). Run automatically on container
 * start by scripts/start.mjs when BOOTSTRAP_ADMIN_EMAIL is set.
 */
const INTERNAL_ORG_SLUG = 'auradesk-internal'
const ADMIN_ROLE_SLUG = 'super_admin'

async function main() {
  const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase()
  if (!adminEmail || !adminEmail.includes('@')) {
    console.log('[bootstrap] BOOTSTRAP_ADMIN_EMAIL not set; skipping.')
    return
  }

  const { db } = await import('@/lib/db')
  const { syncRbac } = await import('@/lib/rbac/sync')

  try {
    const rbac = await syncRbac()

    const existingOrg = await db.organisation.findUnique({ where: { slug: INTERNAL_ORG_SLUG } })
    const org = existingOrg ?? await db.organisation.create({
      data: {
        type: 'AURADESK_INTERNAL',
        legalName: 'Auradesk',
        displayName: 'Auradesk',
        slug: INTERNAL_ORG_SLUG,
        primaryEmail: adminEmail,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      },
    })

    const role = await db.role.findUnique({ where: { slug: ADMIN_ROLE_SLUG } })
    if (!role) throw new Error(`Role "${ADMIN_ROLE_SLUG}" missing after RBAC sync.`)

    const existingUser = await db.user.findUnique({ where: { email: adminEmail } })
    const user = existingUser ?? await db.user.create({
      data: {
        fullName: 'Auradesk Admin', firstName: 'Auradesk', lastName: 'Admin', email: adminEmail,
        status: 'ACTIVE', emailVerifiedAt: new Date(),
      },
    })

    const membership = await db.membership.findUnique({
      where: { userId_organisationId: { userId: user.id, organisationId: org.id } },
    })
    if (!membership) {
      await db.membership.create({
        data: {
          userId: user.id, organisationId: org.id, roleId: role.id, status: 'ACTIVE',
          isPrimary: true, acceptedAt: new Date(), scopeType: 'ORGANISATION',
        },
      })
    }

    console.log('[bootstrap]', JSON.stringify({
      rbacLinks: rbac.links,
      organisation: existingOrg ? 'reused' : 'created',
      admin: { email: adminEmail, user: existingUser ? 'reused' : 'created', membership: membership ? 'reused' : 'created' },
    }))
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error('[bootstrap] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
