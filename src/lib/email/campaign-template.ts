/**
 * Plain campaign email that looks like a normal personal mail: just the message, plus a small
 * unsubscribe line. No logo, card or automatic sign-off. The message is HTML-escaped; Resend
 * fills in the {{{...}}} placeholders per recipient.
 *
 * Links in the message:
 *  - `[text](url)` becomes a link that shows only "text" (what the composer's "Add link" inserts).
 *  - Bare `https://...` or `www....` addresses are linked as they are.
 * Only http(s) links are ever produced; `www.` addresses get https:// in front.
 */

const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}'
const REASON = 'You are receiving this because you signed up or were in touch with Auradeck.'

// 1: link text, 2: its URL  |  3: a bare URL (without trailing punctuation)
const LINK_RE =
  /\[([^\]\n]+)\]\(\s*((?:https?:\/\/|www\.)[^\s<>"'()]+)\s*\)|((?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]])/gi

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const toHref = (url: string) => (/^www\./i.test(url) ? `https://${url}` : url)

const anchor = (url: string, text: string) =>
  `<a href="${escapeHtml(toHref(url))}" style="color:#1a73e8;">${escapeHtml(text)}</a>`

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
  const p = 'margin:0 0 14px;'
  const paragraphs = normalise(message)
    .split(/\n{2,}/)
    .map((block) => `<p style="${p}">${inline(block)}</p>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;max-width:640px;">
${paragraphs}
<p style="margin:28px 0 0;font-size:11px;color:#888888;">${REASON} <a href="${UNSUBSCRIBE}" style="color:#888888;">Unsubscribe</a></p>
</div></body></html>`
}

export const renderCampaignText = ({ message }: { message: string }): string =>
  `${plain(message)}\n\n--\n${REASON}\nUnsubscribe: ${UNSUBSCRIBE}`

/** Test sends and previews: swap Resend's per-recipient placeholders for sample values. */
export const withSampleValues = (s: string): string => s.replace(UNSUBSCRIBE, '#')
