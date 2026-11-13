import { describe, expect, it } from 'vitest'
import { renderCampaignHtml, renderCampaignText, withSampleValues } from '@/lib/email/campaign-template'

describe('campaign template', () => {
  it('escapes HTML in the message', () => {
    const html = renderCampaignHtml({ message: '<script>alert(1)</script> "x" & y' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; y')
  })

  it('turns blank lines into paragraphs and single newlines into line breaks', () => {
    const html = renderCampaignHtml({ message: 'one\ntwo\r\n\r\nthree' })
    expect(html).toContain('>one<br>two</p>')
    expect(html).toContain('>three</p>')
  })

  it('links bare http(s) URLs without trailing punctuation and ignores other schemes', () => {
    const html = renderCampaignHtml({ message: 'See https://auradeck.in/a?x=1&y=2. Or javascript:alert(1)' })
    expect(html).toContain('<a href="https://auradeck.in/a?x=1&amp;y=2"')
    expect(html).toContain('</a>. Or javascript:alert(1)')
    expect(html.match(/<a href="javascript/)).toBeNull()
  })

  it('keeps the greeting, sign-off and unsubscribe placeholders', () => {
    const html = renderCampaignHtml({ message: 'hello' })
    expect(html).toContain('Hi {{{contact.first_name|there}}},')
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"')
    expect(html).toContain('Team Auradeck')
    expect(renderCampaignText({ message: 'hello' })).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
  })

  it('fills sample values for previews and test sends', () => {
    const out = withSampleValues(renderCampaignHtml({ message: 'hello' }))
    expect(out).toContain('Hi Alex,')
    expect(out).not.toContain('{{{')
  })
})
