/**
 * Fixed branded campaign template: only the message varies. The message is HTML-escaped; Resend
 * fills in the {{{...}}} placeholders per recipient.
 *
 * Links in the message:
 *  - `[text](url)` becomes a link that shows only "text" (what the composer's "Add link" inserts).
 *  - Bare `https://...` or `www....` addresses are linked as they are.
 * Only http(s) links are ever produced; `www.` addresses get https:// in front.
 */

import { env } from '@/env'

const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}'
const REASON = 'You are receiving this because you signed up or were in touch with Auradeck.'

// 1: link text, 2: its URL  |  3: a bare URL (without trailing punctuation)
const LINK_RE =
  /\[([^\]\n]+)\]\(\s*((?:https?:\/\/|www\.)[^\s<>"'()]+)\s*\)|((?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]])/gi

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const toHref = (url: string) => (/^www\./i.test(url) ? `https://${url}` : url)

const anchor = (url: string, text: string) =>
  `<a href="${escapeHtml(toHref(url))}" style="color:#4f46e5;text-decoration:underline;">${escapeHtml(text)}</a>`

const inline = (text: string) => {
  let out = ''
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    out += escapeHtml(text.slice(last, m.index))
    out += m[3] ? anchor(m[3], m[3]) : anchor(m[2], m[1].trim())
    last = m.index! + m[0].length
  }
  return (out + escapeHtml(text.slice(last))).replace(/\n/g, '<br>')
}

const normalise = (message: string) => message.replace(/\r\n?/g, '\n').trim()

/** Plain-text version: `[text](url)` reads as "text (url)". */
const plain = (message: string) =>
  normalise(message).replace(LINK_RE, (whole, text: string | undefined, url: string | undefined) =>
    text && url ? `${text.trim()} (${toHref(url)})` : whole
  )

export function renderCampaignHtml({ message }: { message: string }): string {
  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;'
  const paragraphs = normalise(message)
    .split(/\n{2,}/)
    .map((block) => `<p style="${p}">${inline(block)}</p>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Inter,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:20px 32px;border-bottom:1px solid #e5e7eb;"><img src="${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/auradeck-logo.png" width="36" height="36" alt="" style="vertical-align:middle;border:0;"><span style="vertical-align:middle;margin-left:10px;font-size:22px;font-weight:700;color:#4f46e5;">Auradeck</span></td></tr>
<tr><td style="padding:32px;">
${paragraphs}
<p style="${p}">Team Auradeck</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">${REASON}<br><a href="${UNSUBSCRIBE}" style="color:#6b7280;">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`
}

export const renderCampaignText = ({ message }: { message: string }): string =>
  `${plain(message)}\n\nTeam Auradeck\n\n--\n${REASON}\nUnsubscribe: ${UNSUBSCRIBE}`

/** Test sends and previews: swap Resend's per-recipient placeholders for sample values. */
export const withSampleValues = (s: string): string => s.replace(UNSUBSCRIBE, '#')
