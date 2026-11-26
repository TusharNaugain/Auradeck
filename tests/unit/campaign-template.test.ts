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

  it('is a plain mail: no greeting, logo or sign-off, only the unsubscribe placeholder', () => {
    const html = renderCampaignHtml({ message: 'hello' })
    expect(html).not.toMatch(/>Hi /)
    expect(html).not.toContain('first_name')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Team Auradeck')
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"')
    const text = renderCampaignText({ message: 'hello' })
    expect(text.startsWith('hello')).toBe(true)
    expect(text).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
  })

  it('turns [text](url) into a link that shows only the text', () => {
    const html = renderCampaignHtml({ message: 'Use [your invite](https://app.auradeck.in/i/abc?x=1&y=2) or [our page](www.linkedin.com/company/auradeck).' })
    expect(html).toContain('<a href="https://app.auradeck.in/i/abc?x=1&amp;y=2" style="color:#1a73e8;">your invite</a>')
    expect(html).toContain('<a href="https://www.linkedin.com/company/auradeck" style="color:#1a73e8;">our page</a>.')
    expect(html).not.toContain('](')
  })

  it('escapes link text and never links other schemes in [text](url)', () => {
    const html = renderCampaignHtml({ message: '[<b>x</b>](https://a.in) [bad](javascript:alert(1))' })
    expect(html).toContain('>&lt;b&gt;x&lt;/b&gt;</a>')
    expect(html).toContain('[bad](javascript:alert(1))')
    expect(html.match(/href="javascript/)).toBeNull()
  })

  it('links bare www addresses with https', () => {
    const html = renderCampaignHtml({ message: 'Visit www.auradeck.in.' })
    expect(html).toContain('<a href="https://www.auradeck.in" style="color:#1a73e8;">www.auradeck.in</a>.')
  })

  it('writes links as "text (url)" in the plain-text version', () => {
    expect(renderCampaignText({ message: 'See [my LinkedIn](www.linkedin.com/in/me) now' })).toContain('See my LinkedIn (https://www.linkedin.com/in/me) now')
  })

  it('fills sample values for previews and test sends', () => {
    const out = withSampleValues(renderCampaignHtml({ message: 'hello' }))
    expect(out).not.toContain('{{{')
  })
})
