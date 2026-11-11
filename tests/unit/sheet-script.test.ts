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
import { validateValues } from '@/lib/sync/lead-sync'

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

describe('sheet script: Beta Tracker configuration (BetaTracker.gs)', () => {
  const betaSource = readFileSync(path.resolve(process.cwd(), 'docs/sheet-sync/BetaTracker.gs'), 'utf8')
  const betaContext = createContext({ Utilities, console })
  new Script(betaSource).runInContext(betaContext)
  const beta = runInContext('({ CONFIG, mapHeaders_, rowToFields_, newRef_, normalizePhone_, pendingEmails_, mailBody_, sameValue_, writeRecord_ })', betaContext) as {
    CONFIG: { COLUMN_MAP: Record<string, string>; SHEET_NAME: string }
    mapHeaders_: (h: unknown[], m?: Record<string, string>) => Record<string, number>
    rowToFields_: (m: Record<string, number>, r: unknown[]) => Record<string, string>
    newRef_: (f: Record<string, string>) => string
    normalizePhone_: (v: string) => string
    pendingEmails_: (h: unknown[], r: unknown[][]) => { nameCol: number; emailCol: number; sentCol: number; pending: Array<{ index: number; name: string; email: string }> }
    mailBody_: (name: string) => string
    sameValue_: (field: string, a: unknown, b: unknown) => boolean
    writeRecord_: (ctx: unknown, row: number, record: Record<string, string>, values: unknown[]) => Record<string, string>
  }

  const headers = [
    'Name', 'Email ', 'Phone / WhatsApp', 'Lead Source', 'Call Date', 'Demo Date', 'Trial Start Date',
    'Trial End Date (Day 21)', 'Card/UPI Added (Y/N)', 'Session Logged (Y/N)', 'Calendar Synced (Y/N)', '2nd Login (Y/N)',
    'Day-15 Converted (Y/N)', 'Tier (₹499/₹999/₹2999)', 'MRR (₹)', 'Status', 'Notes', 'Clinic / Solo', '',
  ]
  const mapping = beta.mapHeaders_(headers, beta.CONFIG.COLUMN_MAP)
  const row = (over: Record<number, unknown>) => {
    const r: unknown[] = new Array(headers.length).fill('')
    Object.entries(over).forEach(([i, v]) => { r[Number(i)] = v })
    return r
  }

  it('targets the Beta Tracker tab and maps only the columns the CRM understands', () => {
    expect(beta.CONFIG.SHEET_NAME).toBe('Beta Tracker')
    expect(mapping).toEqual({ fullName: 0, email: 1, phone: 2, waitlistSource: 3, painPoints: 16, useCase: 17 })
  })

  it('splits the name, normalises the phone and keeps the source text', () => {
    const fields = beta.rowToFields_(mapping, row({ 0: 'Heena Yadav ', 1: 'heenayadav205@gmail.com', 2: 7042524525, 3: 'Hot lead - Survey ', 16: 'Wants calendar sync' }))
    expect(fields).toMatchObject({
      firstName: 'Heena', lastName: 'Yadav', email: 'heenayadav205@gmail.com', phone: '+917042524525',
      waitlistSource: 'Hot lead - Survey', painPoints: 'Wants calendar sync',
    })
    expect(validateValues(canonicalizePartial(fields))).toEqual([])
  })

  it('never sends a blank name, so it cannot clear the name the CRM already has', () => {
    const fields = beta.rowToFields_(mapping, row({ 1: 'a@b.co', 2: '9828660949' }))
    expect(fields).not.toHaveProperty('firstName')
    expect(fields).not.toHaveProperty('lastName')
  })

  it('handles single names and multi-part surnames', () => {
    expect(beta.rowToFields_(mapping, row({ 0: 'Saakshi', 1: 'x@y.co' }))).toMatchObject({ firstName: 'Saakshi', lastName: '' })
    expect(beta.rowToFields_(mapping, row({ 0: 'Dr Chinu Agrawal', 1: 'x@y.co' }))).toMatchObject({ firstName: 'Dr', lastName: 'Chinu Agrawal' })
  })

  it('normalises Indian numbers only when they are bare 10-digit (or 91-prefixed)', () => {
    expect(beta.normalizePhone_('98286 60949')).toBe('+919828660949')
    expect(beta.normalizePhone_('919828660949')).toBe('+919828660949')
    expect(beta.normalizePhone_('+919828660949')).toBe('+919828660949')
    expect(beta.normalizePhone_('+14155550123')).toBe('+14155550123')
    expect(beta.normalizePhone_('')).toBe('')
  })

  it('gives a new row the same External Ref the import used, so it links instead of duplicating', () => {
    expect(beta.newRef_({ email: ' Heena.Yadav205@Gmail.com ' })).toBe('beta-tracker-heena.yadav205@gmail.com')
    expect(beta.newRef_({})).toBe('uuid')
  })

  it('does not change the default Code.gs behaviour (no prefix, no phone rewriting)', () => {
    const plain = runInContext('({ CONFIG, newRef_, normalizePhone_ })', context) as {
      CONFIG: { REF_PREFIX: string; PHONE_COUNTRY_CODE: string }; newRef_: (f: Record<string, string>) => string; normalizePhone_: (v: string) => string
    }
    expect(plain.CONFIG.REF_PREFIX).toBe('')
    expect(plain.newRef_({ email: 'a@b.co' })).toBe('uuid')
    expect(plain.normalizePhone_('9828660949')).toBe('9828660949')
  })

  describe('sheet cells that refuse a write', () => {
    it('treats 7042524525 and +917042524525 as the same phone, so the cell is not rewritten', () => {
      expect(beta.sameValue_('phone', 7042524525, '+917042524525')).toBe(true)
      expect(beta.sameValue_('phone', '9828660949', '+919828660949')).toBe(true)
      expect(beta.sameValue_('phone', '9828660949', '+919828660950')).toBe(false)
    })

    it('does not abort the sync when a cell has a data-validation rule', () => {
      const writes: unknown[][] = []
      const ctx = {
        mapping: { phone: 2, city: 3 },
        sheet: {
          getRange: (row: number, col: number) => ({
            setValue: (value: unknown) => {
              if (col === 4) throw new Error('The data you entered in cell D2 violates the data validation rules')
              writes.push([row, col, value])
            },
          }),
        },
      }
      expect(() => beta.writeRecord_(ctx, 2, { phone: '+917042524525', city: 'Pune' }, ['', '', 7042524525, ''])).not.toThrow()
      expect(writes).toEqual([]) // phone is the same number; the refused city cell is left alone
    })
  })

  describe('intro e-mails', () => {
    const mailHeaders = ['Name', 'Email ', 'Phone / WhatsApp', 'Email Sent']

    it('finds columns by header, so the phone column is never mistaken for a status', () => {
      const plan = beta.pendingEmails_(mailHeaders, [['Heena Yadav', 'h@x.co', '7042524525', '']])
      expect(plan).toMatchObject({ nameCol: 0, emailCol: 1, sentCol: 3 })
      expect(plan.pending).toEqual([{ index: 0, name: 'Heena Yadav', email: 'h@x.co' }])
    })

    it('skips rows already marked, rows without a valid email, and keeps blank names', () => {
      const plan = beta.pendingEmails_(mailHeaders, [
        ['A', 'a@x.co', '1', 'Sent'],
        ['B', 'not-an-email', '2', ''],
        ['C', '', '3', ''],
        ['', 'd@x.co', '4', ''],
      ])
      expect(plan.pending).toEqual([{ index: 3, name: '', email: 'd@x.co' }])
    })

    it('sends nothing when the Email or Email Sent column is missing', () => {
      expect(beta.pendingEmails_(['Name', 'Phone'], [['A', '1']]).pending).toEqual([])
      expect(beta.pendingEmails_(['Name', 'Email'], [['A', 'a@x.co']]).pending).toEqual([])
    })

    it('greets by name, with a fallback, and keeps the original message', () => {
      expect(beta.mailBody_('Heena Yadav').startsWith('Hi Heena Yadav,')).toBe(true)
      expect(beta.mailBody_('').startsWith('Hi there,')).toBe(true)
      expect(beta.mailBody_('X')).toContain('₹459/month')
    })
  })
})

describe('sheet script: Therapist Referral Circle configuration (TherapistReferral.gs)', () => {
  const load = (file: string) => {
    const ctx = createContext({ Utilities, console })
    new Script(readFileSync(path.resolve(process.cwd(), file), 'utf8')).runInContext(ctx)
    return runInContext('({ CONFIG, mapHeaders_, rowToFields_, withDefaults_, normalizePhone_ })', ctx) as {
      CONFIG: { SHEET_NAME: string; COLUMN_MAP: Record<string, string>; MARK_PRIORITY: boolean; NEW_ROW_DEFAULTS: Record<string, string> }
      mapHeaders_: (h: unknown[], m?: Record<string, string>) => Record<string, number>
      rowToFields_: (m: Record<string, number>, r: unknown[]) => Record<string, string>
      withDefaults_: (f: Record<string, string>) => Record<string, string>
      normalizePhone_: (v: string) => string
    }
  }
  const referral = load('docs/sheet-sync/TherapistReferral.gs')
  const headers = [
    'Timestamp', 'Email Address', '1. Full Name', '2. Professional Title / Role', 'City / Location',
    'Specialisations / Areas of expertise', 'Preferred contact number for referrals', 'Years in experience ', "What's app invite ",
  ]
  const mapping = referral.mapHeaders_(headers, referral.CONFIG.COLUMN_MAP)

  it('targets the form tab and maps the form columns (ignoring years and the WhatsApp invite)', () => {
    expect(referral.CONFIG.SHEET_NAME).toBe('Form Responses 1')
    expect(mapping).toEqual({ signedUpAt: 0, email: 1, fullName: 2, jobTitle: 3, city: 4, useCase: 5, phone: 6 })
  })

  it('turns a form row into fields the CRM accepts', () => {
    const fields = referral.rowToFields_(mapping, [new Date('2026-10-05T09:03:13Z'), 'jvarnika521@gmail.com', 'Varnika Jain', 'Counselling Psychologist', 'Bangalore ', 'Trauma informed', 6397077475, '', 'Message Varnika'])
    expect(fields).toMatchObject({
      email: 'jvarnika521@gmail.com', firstName: 'Varnika', lastName: 'Jain', jobTitle: 'Counselling Psychologist',
      city: 'Bangalore', useCase: 'Trauma informed', phone: '+916397077475', signedUpAt: '2026-10-05T09:03:13.000Z',
    })
    expect(validateValues(canonicalizePartial(fields))).toEqual([])
  })

  it('drops a phone that is not a valid number instead of rejecting the whole row', () => {
    expect(referral.normalizePhone_('98716 77204 / 98111 22233')).toBe('')
    expect(referral.normalizePhone_('12345')).toBe('')
    expect(referral.normalizePhone_('9871677204')).toBe('+919871677204')
    const fields = referral.rowToFields_(mapping, ['', 'a@b.co', 'A B', '', '', '', 'call me', '', ''])
    expect(validateValues(canonicalizePartial(fields))).toEqual([])
  })

  it('gives NEW rows the referral source, but leaves an existing value alone', () => {
    expect(referral.withDefaults_({ email: 'a@b.co' })).toMatchObject({ leadSource: 'referral', waitlistSource: 'Therapist Referral Circle' })
    expect(referral.withDefaults_({ email: 'a@b.co', leadSource: 'website' }).leadSource).toBe('website')
  })

  it('only the early-access script (Code.gs) marks new leads as priority reachout', () => {
    expect(referral.CONFIG.MARK_PRIORITY).toBe(false)
    expect(load('docs/sheet-sync/BetaTracker.gs').CONFIG.MARK_PRIORITY).toBe(false)
    expect(load('docs/sheet-sync/Code.gs').CONFIG.MARK_PRIORITY).toBe(true)
  })
})
