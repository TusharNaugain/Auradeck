/**
 * Staging seed: internal organisation, RBAC (roles + permissions), one admin user.
 *
 *   npm run db:seed
 *
 * Safe to re-run: everything is looked up before it is created and nothing is
 * deleted or overwritten. The admin's generated password is written to .env only
 * (SEED_ADMIN_PASSWORD) and is never printed.
 *
 * Refuses to run unless DATABASE_URL points at the local `crm_staging` database.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import path from 'node:path'

const ENV_PATH = path.resolve(process.cwd(), '.env')
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)

const REQUIRED_DB = 'crm_staging'
const INTERNAL_ORG_SLUG = 'auradesk-internal'
const ADMIN_ROLE_SLUG = 'super_admin'

function assertStaging(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('Refusing to seed: DATABASE_URL is not set.')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Refusing to seed: DATABASE_URL is not a valid URL.') }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if (dbName !== REQUIRED_DB) throw new Error(`Refusing to seed: database is "${dbName}", expected "${REQUIRED_DB}".`)
  if (!localHost) throw new Error(`Refusing to seed: host "${url.hostname}" is not local.`)
}

function generatePassword(length = 24): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@%^*-_+=']
  const all = sets.join('')
  const chars = sets.map((s) => s[randomInt(s.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** Set KEY=value in .env (replace the line if present, else append). Backs the file up once. */
function setEnv(key: string, value: string): void {
  const backup = `${ENV_PATH}.bak-before-seed`
  if (existsSync(ENV_PATH) && !existsSync(backup)) copyFileSync(ENV_PATH, backup)
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  const next = re.test(text) ? text.replace(re, () => line) : text + (text && !text.endsWith('\n') ? eol : '') + line + eol
  writeFileSync(ENV_PATH, next)
  process.env[key] = value
}

async function main() {
  assertStaging()

  // Imported after the guard so nothing connects to a database before it passes.
  const { db } = await import('@/lib/db')
  const { syncRbac } = await import('@/lib/rbac/sync')
  const { hashPassword, verifyPassword } = await import('@/lib/auth/password')

  try {
    const [{ current_database: connected }] = await db.$queryRaw<Array<{ current_database: string }>>`select current_database()`
    if (connected !== REQUIRED_DB) throw new Error(`Refusing to seed: connected to "${connected}".`)

    const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
    if (!adminEmail || !adminEmail.includes('@')) throw new Error('Set SEED_ADMIN_EMAIL in .env first.')

    // 1. RBAC: the app's own sync (permissions catalogue + roles + links).
    const before = { roles: await db.role.count(), permissions: await db.permission.count() }
    const rbac = await syncRbac()
    const after = { roles: await db.role.count(), permissions: await db.permission.count() }

    // 2. Internal organisation (reuse by fixed slug).
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

    // 3. Admin user + credentials + membership. Existing users are left untouched.
    const role = await db.role.findUnique({ where: { slug: ADMIN_ROLE_SLUG } })
    if (!role) throw new Error(`Role "${ADMIN_ROLE_SLUG}" missing after RBAC sync.`)

    let user = await db.user.findUnique({ where: { email: adminEmail }, include: { credentials: true } })
    let userCreated = false
    if (!user) {
      const password = generatePassword()
      setEnv('SEED_ADMIN_PASSWORD', password) // persisted first: a crash can never lose it
      const passwordHash = await hashPassword(password)
      const created = await db.user.create({
        data: {
          fullName: 'Auradesk Admin', firstName: 'Auradesk', lastName: 'Admin', email: adminEmail,
          status: 'ACTIVE', emailVerifiedAt: new Date(),
          credentials: { create: { passwordHash } },
        },
        include: { credentials: true },
      })
      user = created
      userCreated = true
    }

    const membership = await db.membership.findUnique({
      where: { userId_organisationId: { userId: user.id, organisationId: org.id } },
    })
    let membershipCreated = false
    if (!membership) {
      await db.membership.create({
        data: {
          userId: user.id, organisationId: org.id, roleId: role.id, status: 'ACTIVE',
          isPrimary: true, acceptedAt: new Date(), scopeType: 'ORGANISATION',
        },
      })
      membershipCreated = true
    }

    // Keep an explicitly configured sync target; initialize it only when unset.
    if (!process.env.SYNC_ORGANISATION_ID) setEnv('SYNC_ORGANISATION_ID', org.id)

    // 5. Verify, without ever printing the password.
    const check = await db.membership.findFirst({
      where: { userId: user.id, organisationId: org.id, status: 'ACTIVE' },
      include: { role: true, organisation: true },
    })
    const stored = await db.userCredential.findUnique({ where: { userId: user.id } })
    const envPassword = process.env.SEED_ADMIN_PASSWORD ?? ''
    const authOk = !!stored && (await verifyPassword(stored.passwordHash, envPassword))

    console.log(JSON.stringify({
      database: REQUIRED_DB,
      organisation: { action: existingOrg ? 'reused' : 'created', id: org.id, slug: org.slug, type: org.type },
      rbac: {
        permissionsCreated: after.permissions - before.permissions, permissionsTotal: after.permissions,
        rolesCreated: after.roles - before.roles, rolesTotal: after.roles, rolePermissionLinks: rbac.links,
      },
      admin: {
        email: adminEmail, userAction: userCreated ? 'created' : 'reused', membershipAction: membershipCreated ? 'created' : 'reused',
        role: check?.role.slug ?? null, linkedToOrganisation: check?.organisationId === org.id, orgType: check?.organisation.type ?? null,
        passwordInEnvMatchesDatabaseHash: authOk,
      },
      syncOrganisationIdSetInEnv: process.env.SYNC_ORGANISATION_ID === org.id,
    }, null, 2))
    if (!check || !authOk) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Seed failed')
  process.exit(1)
})
