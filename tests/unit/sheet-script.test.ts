/**
 * Loads docs/sheet-sync/Code.gs into a Node VM with a minimal `Utilities` stub and
 * checks that what the sheet script produces is accepted by the server's own
 * verifier. Guards the two things that silently break a first deployment:
 * request signing and header -> field mapping.
 */
import { createContext, runInContext, Script } from 'node:vm'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifySignature } from '@/lib/sync/signature'
import { canonicalizePartial } from '@/lib/sync/engine'

const toSigned = (buf: Buffer) => Array.from(buf).map(b => (b > 127 ? b - 256 : b)) // Apps Script returns signed bytes

const Utilities = {
  computeHmacSha256Signature: (value: string, key: string) => toSigned(createHmac('sha256', key).update(value).digest()),
  computeDigest: (_alg: unknown, value: string) => toSigned(createHash('md5').update(value).digest()),
  DigestAlgorithm: { MD5: 'MD5' },
  getUuid: () => 'uuid',
}

const source = readFileSync(path.resolve(process.cwd(), 'docs/sheet-sync/Code.gs'), 'utf8')
const context = createContext({ Utilities, console })
new Script(source).runInContext(context)
const script = runInContext(
  '({ mapHeaders_, rowToFields_, sign_, buildQuery_, hashFields_, cellToText_, sameValue_, shouldSyncEdit_, norm, newCode, SYNC_FIELDS })',
  context
) as {
  mapHeaders_: (h: unknown[], m?: Record<string, string>) => Record<string, number>
  rowToFields_: (m: Record<string, number>, r: unknown[]) => Record<string, string>
  sign_: (secret: string, ts: string, payload: string) => string
  buildQuery_: (p: Record<string, unknown>) => string
  hashFields_: (f: Record<string, string>) => string
  cellToText_: (v: unknown) => string
  sameValue_: (field: string, a: unknown, b: unknown) => boolean
  shouldSyncEdit_: (sheetName: string, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, mapping: Record<string, number>) => boolean
  norm: (value: string) => string
  newCode: () => string
  SYNC_FIELDS: string[]
}

const secret = 'k'.repeat(40)

describe('sheet script: signing is accepted by the server', () => {
  it('POST: signs the exact body string', () => {
    const ts = String(Date.now())
    const body = JSON.stringify({ batchId: 'b-1234567890', rows: [{ rowRef: 'r', fields: { city: 'Pune – “quoted” ₹' } }] })
    const signature = script.sign_(secret, ts, body)
    expect(verifySignature({ secret, timestamp: ts, signature, payload: body }).ok).toBe(true)
    expect(verifySignature({ secret, timestamp: ts, signature, payload: body + ' ' }).ok).toBe(false)
  })

  it("GET: the signed query string equals what the server reads back from the URL, even with awkward characters", () => {
    const ts = String(Date.now())
    const query = script.buildQuery_({
      cursor: "2026-11-05T10:05:06.000Z|id_o'brien(1)*!", limit: 100, fresh: '1', skipped: '', gone: null,
    })
    expect(query).not.toContain('skipped')
    // What Next's `req.nextUrl.search` yields after URL parsing:
    const serverSide = new URL(`http://localhost/api/sync/sheet/pull?${query}`).search.replace(/^\?/, '')
    expect(serverSide).toBe(query)
    const signature = script.sign_(secret, ts, query)
    expect(verifySignature({ secret, timestamp: ts, signature, payload: serverSide }).ok).toBe(true)
  })

  it('GET with no parameters signs the empty string', () => {
    const ts = String(Date.now())
    expect(script.buildQuery_({})).toBe('')
    expect(verifySignature({ secret, timestamp: ts, signature: script.sign_(secret, ts, ''), payload: '' }).ok).toBe(true)
  })
})

describe('sheet script: header mapping', () => {
  it('maps common header spellings, ignores unknown ones, never maps the same field twice', () => {
    const headers = ['Lead #', 'First Name', 'Last name', 'E-mail', 'Mobile Number', 'Clinic', 'Notes', 'Status', 'Source', 'Stage', 'City', 'City', 'Next Follow-up']
    const m = script.mapHeaders_(headers)
    expect(m).toEqual({
      firstName: 1, lastName: 2, email: 3, phone: 4, organisationName: 5, waitlistSource: 8, lifecycleStage: 9, city: 10, nextFollowUpAt: 12,
    })
  })

  it('does not guess ambiguous columns (Notes / Status stay untouched)', () => {
    const m = script.mapHeaders_(['Notes', 'Status', 'Owner'])
    expect(m).toEqual({})
  })

  it('honours explicit overrides', () => {
    expect(script.mapHeaders_(['Practice owner'], { 'Practice owner': 'firstName' })).toEqual({ firstName: 0 })
    // an override pointing at a non-synced field is ignored
    expect(script.mapHeaders_(['X'], { X: 'leadScore' })).toEqual({})
  })
})

describe('sheet script: row values', () => {
  const mapping = { firstName: 0, phone: 1, nextFollowUpAt: 2, city: 3 }

  it('turns cells into text, dates into ISO, and blanks into empty strings', () => {
    const when = new Date('2026-11-10T09:30:00.000Z')
    const fields = script.rowToFields_(mapping, ['  Casey ', 9876543210, when, ''])
    expect(fields).toEqual({ firstName: 'Casey', phone: '9876543210', nextFollowUpAt: '2026-11-10T09:30:00.000Z', city: '' })
  })

  it('treats an invalid Date as blank instead of crashing', () => {
    expect(script.cellToText_(new Date('nope'))).toBe('')
  })

  it('what the sheet sends canonicalises to what the CRM stores (no phantom diffs)', () => {
    const sent = canonicalizePartial(script.rowToFields_(mapping, ['Casey', '+91 98765 43210', new Date('2026-11-10T09:30:00Z'), 'Pune']))
    expect(sent).toEqual({ firstName: 'Casey', phone: '+919876543210', nextFollowUpAt: '2026-11-10T09:30:00.000Z', city: 'Pune' })
  })

  it('row hash is stable, order-independent and sensitive to edits', () => {
    const a = { firstName: 'A', city: 'Pune' }
    const b = { city: 'Pune', firstName: 'A' }
    expect(script.hashFields_(a)).toBe(script.hashFields_(b))
    expect(script.hashFields_(a)).not.toBe(script.hashFields_({ ...a, city: 'Delhi' }))
    expect(script.hashFields_(a)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('sheet script: the real "Auradeck early access" headers', () => {
  const headers = ['Timestamp', 'Email', 'Source', 'Contacted', 'Invite code', 'Invited at', 'Trial Started ', 'LinkedIn', 'Whats App']

  it('maps every column, and never treats the WhatsApp yes/blank column as a phone number', () => {
    const m = script.mapHeaders_(headers)
    expect(m).toEqual({
      signedUpAt: 0, email: 1, waitlistSource: 2, contacted: 3, inviteCode: 4,
      invitedAt: 5, trialStartedAt: 6, linkedin: 7, whatsappOptIn: 8,
    })
    expect(m).not.toHaveProperty('whatsappNumber')
    expect(m).not.toHaveProperty('leadSource')
  })

  it('sends a real signup row as clean text, with blanks as empty strings', () => {
    const m = script.mapHeaders_(headers)
    const fields = script.rowToFields_(m, [
      new Date('2026-10-09T12:23:47.000Z'), 'kanupriyamody@gmail.com', 'hero', 'YES ', 'AURA-FDL3AU',
      new Date('2026-10-12T00:00:00.000Z'), '', '', '',
    ])
    expect(fields).toMatchObject({
      signedUpAt: '2026-10-09T12:23:47.000Z', email: 'kanupriyamody@gmail.com', waitlistSource: 'hero', contacted: 'YES',
      inviteCode: 'AURA-FDL3AU', trialStartedAt: '', linkedin: '', whatsappOptIn: '',
    })
  })

  it('reads a FALSE checkbox cell as the text "false" (the server then treats it as "no")', () => {
    expect(script.cellToText_(false)).toBe('false')
  })
})

describe('sheet script: equality of cell values', () => {
  it('YES == yes, and FALSE == No == blank, for flag columns', () => {
    expect(script.sameValue_('contacted', 'YES', 'yes')).toBe(true)
    expect(script.sameValue_('contacted', false, 'no')).toBe(true)
    expect(script.sameValue_('contacted', '', 'No')).toBe(true)
    expect(script.sameValue_('contacted', 'YES', 'no')).toBe(false)
    expect(script.sameValue_('whatsappOptIn', 'yes', '')).toBe(false)
  })

  it('ignores case for emails but not for names or free text', () => {
    expect(script.sameValue_('email', 'A@B.com', 'a@b.com')).toBe(true)
    expect(script.sameValue_('city', 'pune', 'Pune')).toBe(false)
    expect(script.sameValue_('waitlistSource', 'Hero', 'hero')).toBe(false)
  })
})

describe('sheet script: edit trigger filtering', () => {
  const mapping = { email: 1, city: 3 }

  it('syncs edits to mapped data columns and ignores headers, metadata, and other tabs', () => {
    expect(script.shouldSyncEdit_('Sheet1', 2, 2, 2, 2, mapping)).toBe(true)
    expect(script.shouldSyncEdit_('Sheet1', 1, 3, 2, 2, mapping)).toBe(true)
    expect(script.shouldSyncEdit_('Sheet1', 1, 1, 2, 2, mapping)).toBe(false)
    expect(script.shouldSyncEdit_('Sheet1', 2, 2, 5, 6, mapping)).toBe(false)
    expect(script.shouldSyncEdit_('Archive', 2, 2, 2, 2, mapping)).toBe(false)
  })
})

describe('sheet script: beta invite helpers', () => {
  it('normalizes whitespace and case in headers and email comparisons', () => {
    expect(script.norm('  Invite\u00a0  CODE ')).toBe('invite code')
  })

  it('generates invite codes in the expected format without ambiguous characters', () => {
    expect(script.newCode()).toMatch(/^AURA-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  })
})
