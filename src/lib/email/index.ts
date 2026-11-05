/**
 * Email provider abstraction (Resend | Postmark | SMTP | console/log-only development).
 * Never logs or renders sensitive data; email bodies must contain no access tokens.
 */

import { env } from '@/env'
import { logger } from '@/lib/utils/logger'
import nodemailer from 'nodemailer'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  tags?: string[]
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string }>
}

/* ---------- Resend ---------- */

class ResendProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: message.tags?.map((tag) => ({ name: 'category', value: tag })),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.error('Resend email failed', { status: res.status, body: body.slice(0, 500) })
      throw new Error(`Resend delivery failed (${res.status})`)
    }
    const data = (await res.json()) as { id?: string }
    return { id: data.id ?? 'unknown' }
  }
}

/* ---------- Postmark ---------- */

class PostmarkProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN ?? '',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        From: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        MessageStream: 'outbound',
        Metadata: message.tags?.length ? { category: message.tags.join(',') } : undefined,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.error('Postmark email failed', { status: res.status, body: body.slice(0, 500) })
      throw new Error(`Postmark delivery failed (${res.status})`)
    }
    const data = (await res.json()) as { MessageID?: string }
    return { id: data.MessageID ?? 'unknown' }
  }
}

/* ---------- SMTP (nodemailer) ---------- */

class SmtpProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    })
    const info = await transport.sendMail({
      from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    return { id: info.messageId }
  }
}

/* ---------- Development (logs only, never sends anywhere) ---------- */

class DevProvider implements EmailProvider {
  async send(message: EmailMessage) {
    logger.info('DEV EMAIL (console-only, not actually sent)', {
      to: message.to,
      subject: message.subject,
      preview: message.text.slice(0, 200),
    })
    return { id: `dev-${Date.now()}` }
  }
}

let provider: EmailProvider | null = null

function getProvider(): EmailProvider {
  if (provider) return provider
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      provider = env.RESEND_API_KEY ? new ResendProvider() : new DevProvider()
      break
    case 'postmark':
      provider = env.POSTMARK_SERVER_TOKEN ? new PostmarkProvider() : new DevProvider()
      break
    case 'smtp':
      provider = new SmtpProvider()
      break
    default:
      provider = new DevProvider()
  }
  return provider
}

/** Send an email; failures are logged and swallowed (critical flows check return code separately). */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const isDevNoProvider =
    env.NODE_ENV !== 'production' && env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST === 'localhost'
  const effective = isDevNoProvider ? new DevProvider() : getProvider()
  try {
    await effective.send(message)
    return true
  } catch (err) {
    logger.error('Email send failed', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/* ---------- Branded templates (no secrets inside bodies) ---------- */

const APP_URL = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function template(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2937;margin:0;background:#f4f5f7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:700;color:#4f46e5;margin-bottom:16px;">AuraDeck</div>
    <h1 style="font-size:18px;margin:0 0 12px;">${title}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <p style="font-size:12px;color:#6b7280;margin:0;">This is an automated message from AuraDeck CRM. If you did not request this, you can safely ignore this email.</p>
  </div></body></html>`
}

const linkButton = (href: string, label: string) =>
  `<table style="margin:20px 0;"><tr><td style="background:#4f46e5;border-radius:8px;">
  <a href="${href}" style="color:#fff;text-decoration:none;padding:12px 24px;display:inline-block;font-weight:600;">${label}</a></td></tr></table>`

export function emailVerificationEmail(url: string): EmailTemplateArgs {
  return {
    subject: 'Verify your AuraDeck email',
    html: template(
      'Welcome to AuraDeck',
      `<p>Confirm your email address to activate your AuraDeck account. This link expires in 24 hours.</p>
      ${linkButton(url, 'Verify Email') || ''}
      <p style="font-size:12px;color:#6b7280;">Or paste this URL in your browser: <a href="${url}">${url}</a></p>`
    ),
  }
}

interface EmailTemplateArgs {
  subject: string
  html: string
}

export function passwordResetEmail(url: string): EmailTemplateArgs {
  return {
    subject: 'Reset your AuraDeck password',
    html: template(
      'Password Reset',
      `<p>We received a request to reset your AuraDeck CRM password. This link expires in 60 minutes and can only be used once.</p>
      ${linkButton(url, 'Reset Password')}
      <p style="font-size:12px;color:#6b7280;">If you didn't request this, no action is needed — your password remains unchanged.</p>`
    ),
  }
}

export function invitationEmail(url: string, organisationName: string, invitedByName: string): EmailTemplateArgs {
  return {
    subject: `You've been invited to ${organisationName} on AuraDeck`,
    html: template(
      `Join ${organisationName}`,
      `<p>${invitedByName} has invited you to join <strong>${organisationName}</strong> on AuraDeck CRM as a team member. This invitation expires in 7 days.</p>
      ${linkButton(url, 'Accept Invitation')}
      <p style="font-size:12px;color:#6b7280;">Or paste this URL in your browser: <a href="${url}">${url}</a></p>`
    ),
  }
}

/** Convenience wrapper used everywhere */
export async function sendTemplatedEmail(to: string, args: EmailTemplateArgs): Promise<boolean> {
  return sendEmail({
    to,
    subject: args.subject,
    html: args.html,
    // Keep a simple text version — extract link URLs at least
    text: (args.html.match(/https?:\/\/[^"'\s<]+/g) ?? []).join('\n') || args.subject,
  })
}

// Named export for template use elsewhere
export { APP_URL as appUrl }
