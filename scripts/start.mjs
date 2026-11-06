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

if (process.env.BOOTSTRAP_ADMIN_EMAIL) {
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
