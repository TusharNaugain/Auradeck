/**
 * Environment variable validation at startup.
 * This ensures the application fails fast with clear error messages
 * rather than mysterious runtime failures.
 */

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('AuraDeck CRM'),
  DATABASE_URL: z.string().default(
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/placeholder?schema=public'
  ),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').default(
    process.env.SESSION_SECRET || '3ba656f3d7c696839825a8fbae6254d6925573c2471d1899a2b1df3c9476f5b3'
  ),
  IRON_SESSION_PASSWORD: z.string().min(32, 'IRON_SESSION_PASSWORD must be at least 32 characters').default(
    process.env.IRON_SESSION_PASSWORD || '0134edcc87feea06429e07f15dae2828377c0e0b80146f17098362c9b046efe6'
  ),
  EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'smtp']).default('smtp'),
  EMAIL_FROM_ADDRESS: z.string().email().default('noreply@auradeck.in'),
  EMAIL_FROM_NAME: z.string().default('AuraDeck CRM'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_URL: z.string().url().default('https://api.resend.com'),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().transform(v => v === 'true').default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().default(300),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123456'),
  SEED_USER_PASSWORD: z.string().default('User@123456'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters').optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
})

type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  // Only validate on server side
  if (typeof window !== 'undefined') return {} as Env

  const result = envSchema.safeParse(process.env)
  if (result.success) return result.data

  // Drop only the invalid variables and fall back to their defaults, so one bad
  // value (e.g. a malformed EMAIL_FROM_ADDRESS) does not discard every other
  // configured variable such as GOOGLE_CLIENT_ID or DATABASE_URL.
  const fieldErrors = result.error.flatten().fieldErrors
  console.warn('⚠️ Environment variable validation warnings (using defaults for these):')
  console.warn(fieldErrors)

  const sanitized: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(fieldErrors)) delete sanitized[key]
  return envSchema.parse(sanitized)
}

/**
 * In production a localhost NEXT_PUBLIC_APP_URL is always a misconfiguration and
 * breaks OAuth redirects. Fall back to the platform-provided public domain.
 */
function resolveAppUrl(e: Env): Env {
  if (typeof window !== 'undefined') return e
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
  // On Railway a localhost URL is never correct, whatever NODE_ENV says.
  if (e.NODE_ENV !== 'production' && !publicDomain) return e
  let host = ''
  try {
    host = new URL(e.NEXT_PUBLIC_APP_URL).hostname
  } catch {
    host = ''
  }
  const isLocal = !host || ['localhost', '127.0.0.1', '0.0.0.0'].includes(host)
  if (isLocal && publicDomain) {
    console.warn(`⚠️ NEXT_PUBLIC_APP_URL is "${e.NEXT_PUBLIC_APP_URL}" in production; using https://${publicDomain}`)
    return { ...e, NEXT_PUBLIC_APP_URL: `https://${publicDomain}` }
  }
  return e
}

export const env = resolveAppUrl(loadEnv())
