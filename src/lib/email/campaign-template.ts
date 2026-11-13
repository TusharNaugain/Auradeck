/**
 * Fixed branded campaign template: only the message varies. The message is HTML-escaped; Resend
 * fills in the {{{...}}} placeholders per recipient.
 */

const FIRST_NAME = '{{{contact.first_name|there}}}'
const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}'
const REASON = 'You are receiving this because you signed up or were in touch with Auradeck.'
const URL_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const inline = (text: string) =>
  text
    .split(URL_RE)
    .map((part, i) =>
      i % 2 ? `<a href="${escapeHtml(part)}" style="color:#4f46e5;">${escapeHtml(part)}</a>` : escapeHtml(part)
    )
    .join('')
    .replace(/\n/g, '<br>')

const normalise = (message: string) => message.replace(/\r\n?/g, '\n').trim()

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
<tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;font-size:22px;font-weight:700;color:#4f46e5;">Auradeck</td></tr>
<tr><td style="padding:32px;">
<p style="${p}">Hi ${FIRST_NAME},</p>${paragraphs}
<p style="${p}">Team Auradeck</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">${REASON}<br><a href="${UNSUBSCRIBE}" style="color:#6b7280;">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`
}

export const renderCampaignText = ({ message }: { message: string }): string =>
  `Hi ${FIRST_NAME},\n\n${normalise(message)}\n\nTeam Auradeck\n\n--\n${REASON}\nUnsubscribe: ${UNSUBSCRIBE}`

/** Test sends and previews: swap Resend's per-recipient placeholders for sample values. */
export const withSampleValues = (s: string): string =>
  s.replace(FIRST_NAME, 'Alex').replace(UNSUBSCRIBE, '#')
