#!/usr/bin/env node
/**
 * scripts/dev.mjs — Smart dev server launcher with automatic route warm-up.
 *
 * Usage: node scripts/dev.mjs
 *   (or add "dev:warm": "node scripts/dev.mjs" to package.json scripts)
 *
 * What it does:
 *   1. Spawns `next dev --turbo` as a child process (inherits stdio).
 *   2. Monitors stdout for the "Ready" message.
 *   3. Once ready, fires GET /api/warmup which triggers parallel compilation
 *      of all major routes so first user navigation has zero compile lag.
 *   4. Logs a summary of which routes were warmed and how long it took.
 *
 * Warm-up happens in the background — the server is usable immediately
 * after the "Ready" banner; warm-up just pre-compiles routes concurrently.
 */

import { spawn } from 'child_process'

const PORT = process.env.PORT ?? 3000
const WARMUP_URL = `http://localhost:${PORT}/api/warmup`
// Give the server a short grace period after "Ready" before hitting warmup
const GRACE_MS = 500

let warmed = false

function warmup() {
  if (warmed) return
  warmed = true

  setTimeout(async () => {
    console.log('\n🔥 [warmup] Pre-compiling routes in the background...')
    try {
      const res = await fetch(WARMUP_URL, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) {
        console.warn(`⚠️  [warmup] Server returned ${res.status} — skipping.`)
        return
      }
      const data = await res.json()
      const { warmupMs, routes } = data
      const ok = routes.filter(r => r.ok).length
      const failed = routes.filter(r => !r.ok).length
      console.log(`✅ [warmup] Done in ${warmupMs}ms — ${ok} routes compiled, ${failed} skipped/errored.`)
      if (failed > 0) {
        for (const r of routes.filter(r => !r.ok)) {
          console.log(`   ⚠️  ${r.route}: ${r.error ?? `HTTP ${r.httpStatus}`}`)
        }
      }
    } catch (err) {
      console.warn(`⚠️  [warmup] Failed: ${err.message}`)
    }
  }, GRACE_MS)
}

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'dev', '--turbo', '--port', String(PORT)],
  {
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
  }
)

child.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)
  // Next.js prints "○ Ready" or "✓ Ready" — catch both variants
  if (!warmed && /Ready/i.test(text)) {
    warmup()
  }
})

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))

