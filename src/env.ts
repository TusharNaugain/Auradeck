/**
 * Environment variable validation at startup.
 * This ensures the application fails fast with clear error messages
 * rather than mysterious runtime failures.
 */

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('AuraDeck CRM'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  IRON_SESSION_PASSWORD: z.string().min(32, 'IRON_SESSION_PASSWORD must be at least 32 characters'),
  EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'smtp']).default('smtp'),
  EMAIL_FROM_ADDRESS: z.string().email().default('noreply@auradeck.in'),
  EMAIL_FROM_NAME: z.string().default('AuraDeck CRM'),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().transform(v => v === 'true').default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['local', 's3', 'cloudflare-r2']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().default('auradeck-crm'),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  PAYMENT_PROVIDER: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  WHATSAPP_PROVIDER: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().default(300),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123456'),
  SEED_USER_PASSWORD: z.string().default('User@123456'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters').optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
})

// Only validate on server side
const _env = typeof window === 'undefined'
  ? envSchema.safeParse(process.env)
  : { success: true, data: {} as z.infer<typeof envSchema> }

if (typeof window === 'undefined' && !_env.success) {
  console.error('❌ Invalid environment variables:')
  if ('error' in _env) {
    console.error(_env.error.flatten().fieldErrors)
  }
  // In production, throw. In test/dev, warn only for optional vars.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Invalid environment variables. Check your .env file.')
  }
}

export const env = (_env.success ? _env.data : {}) as z.infer<typeof envSchema>
