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

if (run('npx', ['prisma', 'migrate', 'deploy']) !== 0) {
  console.error('[start] prisma migrate deploy failed; aborting.')
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
