/**
 * Container entrypoint: apply DB migrations, optionally bootstrap the admin,
 * then start Next.js. Migration failure aborts startup; bootstrap failure is
 * logged but does not block the app.
 */
import { spawnSync, spawn } from 'node:child_process'

function run(cmd, args) {
  console.log(`[start] ${cmd} ${args.join(' ')}`)
  return spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1
}

// Print where DATABASE_URL points (never the credentials) and fail fast on a
// local value when running on Railway, which can never be right there.
function describeDatabaseUrl(raw) {
  if (!raw) return { host: '(empty)', db: '', local: true }
  try {
    const u = new URL(raw)
    return { host: u.hostname, db: u.pathname.replace(/^\//, ''), local: ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) }
  } catch {
    return { host: '(unparseable)', db: '', local: true }
  }
}
const dbInfo = describeDatabaseUrl(process.env.DATABASE_URL)
console.log(`[start] DATABASE_URL -> host=${dbInfo.host} db=${dbInfo.db} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`)
if (process.env.RAILWAY_ENVIRONMENT_NAME && dbInfo.local) {
  console.error(
    '[start] DATABASE_URL points to localhost/empty on Railway. On the APP service set DATABASE_URL to the ' +
    'Postgres reference (${{<PostgresServiceName>.DATABASE_URL}}), press Deploy so the change applies, and remove NODE_ENV=development.'
  )
  process.exit(1)
}

// Railway's private network (and a freshly restarted Postgres) can take a few
// seconds to become reachable, so retry migrations before giving up.
const MIGRATE_ATTEMPTS = 6
let migrated = false
for (let attempt = 1; attempt <= MIGRATE_ATTEMPTS; attempt++) {
  if (run('npx', ['prisma', 'migrate', 'deploy']) === 0) {
    migrated = true
    break
  }
  if (attempt < MIGRATE_ATTEMPTS) {
    console.error(`[start] migrate attempt ${attempt} failed; retrying in 5s...`)
    await new Promise((r) => setTimeout(r, 5000))
  }
}
if (!migrated) {
  console.error('[start] prisma migrate deploy failed; aborting. Check DATABASE_URL on the app service.')
  process.exit(1)
}

if (process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.BOOTSTRAP_MEMBER_EMAILS) {
  if (run('npx', ['tsx', 'src/lib/db/bootstrap.ts']) !== 0) {
    console.error('[start] bootstrap failed; continuing to start the app.')
  }
}

const child = spawn('npx', ['next', 'start', '-H', '0.0.0.0'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
