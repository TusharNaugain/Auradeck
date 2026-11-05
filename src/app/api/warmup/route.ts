/**
 * GET /api/warmup — Dev-only route pre-compilation trigger.
 *
 * Compiles top routes sequentially (one-by-one) so it does NOT flood the compiler
 * with concurrent jobs or freeze dev navigation.
 */

import { NextRequest, NextResponse } from 'next/server'

/** Top most-visited routes only — keep small so compilation completes in 3-4s total */
const WARMUP_ROUTES = [
  '/dashboard',
  '/leads',
  '/tasks',
  '/api/reports/overview',
] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ success: false, error: 'Not available in production' }, { status: 404 })
  }

  const origin = req.nextUrl.origin
  const start = Date.now()
  const summary: Array<{ route: string; httpStatus?: number; ok: boolean; error?: string }> = []

  // Compile routes sequentially — prevents CPU starvation and compiler locks
  for (const route of WARMUP_ROUTES) {
    const url = `${origin}${route}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { cookie: req.headers.get('cookie') ?? '' },
        redirect: 'manual',
      })
      summary.push({ route, httpStatus: res.status, ok: true })
    } catch (err) {
      summary.push({ route, error: (err as Error)?.message ?? 'unknown', ok: false })
    } finally {
      clearTimeout(timer)
    }
  }

  return NextResponse.json({
    success: true,
    warmupMs: Date.now() - start,
    routes: summary,
  })
}

