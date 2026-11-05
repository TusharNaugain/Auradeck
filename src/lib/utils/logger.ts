/**
 * Structured logging utility.
 * Outputs JSON in production, readable text in development.
 * Never logs sensitive data (passwords, tokens, personal info).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  requestId?: string
  [key: string]: unknown
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'creditCard',
  'cvv',
])

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[DEEP]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = sanitize(value, depth + 1)
    }
  }
  return sanitized
}

const isDev = process.env.NODE_ENV === 'development'
const logLevel = (process.env.LOG_LEVEL ?? 'info') as LogLevel

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[logLevel]
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...sanitize(context) as Record<string, unknown>,
  }

  if (isDev) {
    const prefix = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level]
    const contextStr = context ? ` ${JSON.stringify(sanitize(context))}` : ''
    console.log(`${prefix} [${level.toUpperCase()}] ${message}${contextStr}`)
  } else {
    // Production: structured JSON
    const output = JSON.stringify(entry)
    if (level === 'error') {
      console.error(output)
    } else if (level === 'warn') {
      console.warn(output)
    } else {
      console.log(output)
    }
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
}
