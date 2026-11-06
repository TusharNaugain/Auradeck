/**
 * Production bootstrap: RBAC catalogue, internal organisation, one admin user.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com tsx src/lib/db/bootstrap.ts
 *
 * Idempotent: everything is looked up before it is created; nothing is deleted
 * or overwritten. The admin is created WITHOUT a password — they sign in with
 * Google (or use "Forgot password" to set one). Run automatically on container
 * start by scripts/start.mjs when BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_MEMBER_EMAILS is set.
 *
 * BOOTSTRAP_MEMBER_EMAILS adds team members without sending any email:
 *   BOOTSTRAP_MEMBER_EMAILS="a@x.com,b@y.com:sales_head"
 * Each entry is `email` or `email:role`; the role defaults to BOOTSTRAP_MEMBER_ROLE
 * (default `sales_rep`). Members are only ever ADDED: an existing membership, its role
 * and its status are never changed, so later edits in Settings -> Members are preserved.
 */
const INTERNAL_ORG_SLUG = 'auradesk-internal'
const ADMIN_ROLE_SLUG = 'super_admin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseMembers(raw: string, defaultRole: string): Array<{ email: string; role: string }> {
  const seen = new Set<string>()
  const out: Array<{ email: string; role: string }> = []
  for (const part of raw.split(/[,;\n]/)) {
    const entry = part.trim()
    if (!entry) continue
    const [emailPart, rolePart] = entry.split(':')
    const email = (emailPart ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      console.warn(`[bootstrap] ignoring invalid member entry: "${entry}"`)
      continue
    }
    if (seen.has(email)) continue
    seen.add(email)
    out.push({ email, role: (rolePart ?? '').trim() || defaultRole })
  }
  return out
}

async function main() {
  const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const hasAdmin = adminEmail.includes('@')
  const defaultRole = (process.env.BOOTSTRAP_MEMBER_ROLE ?? '').trim() || 'sales_rep'
  const members = parseMembers(process.env.BOOTSTRAP_MEMBER_EMAILS ?? '', defaultRole)
  if (!hasAdmin && members.length === 0) {
    console.log('[bootstrap] BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_MEMBER_EMAILS not set; skipping.')
    return
  }

  const { db } = await import('@/lib/db')
  const { syncRbac } = await import('@/lib/rbac/sync')

  try {
    const rbac = await syncRbac()

    const existingOrg = await db.organisation.findUnique({ where: { slug: INTERNAL_ORG_SLUG } })
    if (!existingOrg && !hasAdmin) {
      console.error('[bootstrap] internal organisation does not exist yet; set BOOTSTRAP_ADMIN_EMAIL first.')
      return
    }
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

    const adminResult: Record<string, string> | null = hasAdmin ? await (async () => {
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
      return { email: adminEmail, user: existingUser ? 'reused' : 'created', membership: membership ? 'reused' : 'created' }
    })() : null

    const memberResults: Array<{ email: string; role: string; result: string }> = []
    for (const member of members) {
      if (hasAdmin && member.email === adminEmail) {
        memberResults.push({ ...member, result: 'skipped (is the admin)' })
        continue
      }
      const role = await db.role.findUnique({ where: { slug: member.role } })
      if (!role) {
        console.warn(`[bootstrap] unknown role "${member.role}" for ${member.email}; skipped`)
        memberResults.push({ ...member, result: `skipped (unknown role ${member.role})` })
        continue
      }
      const existing = await db.user.findUnique({ where: { email: member.email } })
      const user = existing ?? await db.user.create({
        data: {
          fullName: member.email.split('@')[0], firstName: member.email.split('@')[0], lastName: '',
          email: member.email, status: 'ACTIVE', emailVerifiedAt: new Date(),
        },
      })
      const hasMembership = await db.membership.findUnique({
        where: { userId_organisationId: { userId: user.id, organisationId: org.id } },
      })
      if (hasMembership) {
        memberResults.push({ ...member, result: `kept existing (${hasMembership.status})` })
        continue
      }
      await db.membership.create({
        data: {
          userId: user.id, organisationId: org.id, roleId: role.id, status: 'ACTIVE',
          isPrimary: false, acceptedAt: new Date(), scopeType: 'ORGANISATION',
        },
      })
      memberResults.push({ ...member, result: existing ? 'membership added' : 'user + membership created' })
    }

    console.log('[bootstrap]', JSON.stringify({
      rbacLinks: rbac.links,
      organisation: existingOrg ? 'reused' : 'created',
      admin: adminResult,
      members: memberResults,
    }))
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error('[bootstrap] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
