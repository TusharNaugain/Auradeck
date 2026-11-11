/**
 * AuraDeck CRM <- Google Sheet lead sync (Google Apps Script).
 *
 * Paste into the sheet's Extensions > Apps Script editor. Setup steps are in
 * docs/sheet-sync/README.md. NEVER put the secret in this file: it lives in
 * Project Settings > Script properties.
 *
 * What it guarantees (the server enforces the rest):
 *  - It never deletes a row, and never writes over a cell you edited since the last sync.
 *  - It pushes first, then pulls, then confirms (acks) only what it actually wrote.
 *  - New rows get a permanent External Ref BEFORE they are sent, so a retry cannot duplicate them.
 *  - Rows it cannot match to a header are left completely alone.
 */

/* ============================== configuration ============================== */

const CONFIG = {
  SHEET_NAME: 'Sheet1',     // tab that holds the leads (your "Auradeck early access" sheet uses Sheet1)
  HEADER_ROW: 1,            // row containing column titles
  BATCH_SIZE: 100,          // rows per push request (server max 500)
  MAX_PULL_PAGES: 20,       // safety stop per run; the cursor resumes next run
  LOCK_WAIT_MS: 30000,
  // Optional exact overrides: { 'My Column Title': 'city' }. Normally not needed.
  COLUMN_MAP: {},
  // Optional. When set, a new row's permanent External Ref is PREFIX + its email (instead of a random id), so a
  // sheet whose leads were already imported links to them on the first sync instead of being rejected as duplicates.
  REF_PREFIX: '',
  // Optional, e.g. '91'. A bare 10-digit phone number is sent as +<code><number> so it matches the CRM's format.
  PHONE_COUNTRY_CODE: '',
};

const SPECIAL_HEADERS = {
  LEAD_NUMBER: 'CRM Lead Number',
  EXTERNAL_REF: 'CRM External Ref',
  STATUS: 'CRM Sync Status',
};

const STATE_SHEET = '_CRM_SYNC_STATE';
const SYNC_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'whatsappNumber', 'organisationName', 'jobTitle',
  'city', 'state', 'leadSource', 'lifecycleStage', 'nextFollowUpAt', 'painPoints', 'useCase',
  'contacted', 'waitlistSource', 'inviteCode', 'invitedAt', 'trialStartedAt', 'signedUpAt', 'linkedin', 'whatsappOptIn',
];

// Columns that hold dates (written back as real dates) and yes/no flags (compared as booleans).
const DATE_FIELDS = ['nextFollowUpAt', 'invitedAt', 'trialStartedAt', 'signedUpAt'];
const FLAG_FIELDS = ['contacted', 'whatsappOptIn'];
// Fields where upper/lower case is never meaningful (YES = yes), so a case-only difference is not a change.
const CASE_INSENSITIVE_FIELDS = ['email', 'leadSource', 'lifecycleStage', 'contacted', 'whatsappOptIn'];

// Header text (spaces/punctuation/case ignored) -> CRM field.
const FIELD_ALIASES = {
  firstName: ['first name', 'firstname', 'first'],
  lastName: ['last name', 'lastname', 'last', 'surname'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact number', 'contact'],
  whatsappNumber: ['whatsapp number', 'whatsapp no', 'whatsapp phone'],
  organisationName: ['organisation', 'organization', 'organisation name', 'company', 'clinic', 'practice'],
  jobTitle: ['job title', 'title', 'designation', 'role'],
  city: ['city'],
  state: ['state'],
  // "Source" holds free text like hero / survey / refferal. It is kept as-is (waitlistSource);
  // the CRM's own lead-source category is derived from it only when a lead is first created.
  waitlistSource: ['source', 'signup source'],
  leadSource: ['lead source', 'lead source category'],
  lifecycleStage: ['stage', 'lead stage', 'lifecycle stage'],
  nextFollowUpAt: ['next follow up', 'next follow-up', 'follow up', 'follow-up date', 'next follow up at'],
  painPoints: ['pain points', 'painpoints'],
  useCase: ['use case', 'usecase'],
  contacted: ['contacted', 'was contacted'],
  inviteCode: ['invite code', 'invitecode', 'invite'],
  invitedAt: ['invited at', 'invited on', 'invite date'],
  trialStartedAt: ['trial started', 'trial start', 'trial started at', 'trial start date'],
  signedUpAt: ['timestamp', 'signed up at', 'signup time', 'submitted at'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  // A yes/blank column called "WhatsApp" is a flag, not a phone number.
  whatsappOptIn: ['whatsapp', 'whats app', 'whatsapp opt in'],
};

/* ================================== menu =================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM Sync')
    .addItem('Sync now', 'syncNowInteractive')
    .addItem('Check connection & server status', 'showServerStatus')
    .addSeparator()
    .addItem('Set up sheet (columns & mapping check)', 'setupSheet')
    .addItem('Turn on auto-sync (on edit + 5-min safety)', 'installTrigger')
    .addItem('Turn off auto-sync', 'removeTrigger')
    .addSeparator()
    .addItem('Sync now – I reviewed a halted batch, apply it', 'syncConfirmMassChange')
    .addToUi();

  SpreadsheetApp.getUi().createMenu('Beta')
    .addItem('Send invites to selected rows', 'sendInvites')
    .addToUi();
}

/* ============================ pure helper functions ======================== */
/* (No Apps Script services used here, so they are unit-tested in Node.)       */

function normalizeHeader_(text) {
  return String(text === null || text === undefined ? '' : text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** headers[] -> { field: zeroBasedColumnIndex }. First match wins; unmatched headers are ignored. */
function mapHeaders_(headers, columnMap) {
  const overrides = {};
  Object.keys(columnMap || {}).forEach(function (title) { overrides[normalizeHeader_(title)] = columnMap[title]; });
  const aliasToField = {};
  Object.keys(FIELD_ALIASES).forEach(function (field) {
    FIELD_ALIASES[field].forEach(function (alias) { aliasToField[normalizeHeader_(alias)] = field; });
  });
  const mapping = {};
  headers.forEach(function (header, index) {
    const key = normalizeHeader_(header);
    const field = overrides[key] || aliasToField[key];
    // 'fullName' is a pseudo-field (only via COLUMN_MAP): one "Name" column split into first + last name.
    if (field && (field === 'fullName' || SYNC_FIELDS.indexOf(field) !== -1) && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
}

function cellToText_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value).trim();
}

/** True when two cell values mean the same thing (YES == yes, FALSE == blank == no). */
function sameValue_(field, a, b) {
  const x = cellToText_(a);
  const y = cellToText_(b);
  if (FLAG_FIELDS.indexOf(field) !== -1) return isYes_(x) === isYes_(y);
  if (field === 'phone' || field === 'whatsappNumber') return normalizePhone_(x) === normalizePhone_(y);
  if (CASE_INSENSITIVE_FIELDS.indexOf(field) !== -1) return x.toLowerCase() === y.toLowerCase();
  return x === y;
}

function isYes_(text) { return ['yes', 'y', 'true', '1', 'x'].indexOf(String(text).toLowerCase()) !== -1; }

/** Row values -> { field: text } for every mapped column (empty cell = '' = "clear it"). */
function rowToFields_(mapping, rowValues) {
  const fields = {};
  Object.keys(mapping).forEach(function (field) {
    const text = cellToText_(rowValues[mapping[field]]);
    if (field === 'fullName') {
      // A blank name cell sends nothing, so it can never clear a name the CRM already has.
      const name = splitName_(text);
      if (name.firstName) { fields.firstName = name.firstName; fields.lastName = name.lastName; }
    } else if (field === 'phone' || field === 'whatsappNumber') {
      fields[field] = normalizePhone_(text);
    } else {
      fields[field] = text;
    }
  });
  return fields;
}

function splitName_(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

/** Bare 10-digit (or 91 + 10-digit) numbers get a "+" and country code when CONFIG.PHONE_COUNTRY_CODE is set. */
function normalizePhone_(text) {
  const code = CONFIG.PHONE_COUNTRY_CODE;
  const compact = String(text || '').replace(/[\s\-()]/g, '');
  if (!code || !compact) return text;
  if (/^\d{10}$/.test(compact)) return '+' + code + compact;
  if (compact.indexOf(code) === 0 && /^\d{10}$/.test(compact.slice(code.length))) return '+' + compact;
  return text;
}

/** Permanent External Ref for a new row: PREFIX + email when configured, otherwise a random id. */
function newRef_(fields) {
  const email = String(fields.email || '').trim().toLowerCase();
  return CONFIG.REF_PREFIX && email ? CONFIG.REF_PREFIX + email : Utilities.getUuid();
}

function toHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Same scheme the server verifies: HMAC-SHA256(secret, timestamp + '.' + payload). */
function sign_(secret, timestamp, payload) {
  return toHex_(Utilities.computeHmacSha256Signature(timestamp + '.' + payload, secret));
}

function buildQuery_(params) {
  return Object.keys(params)
    .filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
    .map(function (k) { return strictEncode_(k) + '=' + strictEncode_(String(params[k])); })
    .join('&');
}

/** encodeURIComponent leaves ! ' ( ) * alone; escape them too so the signed string survives any URL normalisation. */
function strictEncode_(text) {
  return encodeURIComponent(text).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}

function hashFields_(fields) {
  const ordered = SYNC_FIELDS.map(function (f) { return [f, fields[f] === undefined ? '' : fields[f]]; });
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(ordered)));
}

function shouldSyncEdit_(sheetName, firstRow, lastRow, firstColumn, lastColumn, mapping) {
  if (sheetName !== CONFIG.SHEET_NAME || lastRow < Math.max(firstRow, CONFIG.HEADER_ROW + 1)) return false;
  return Object.keys(mapping).some(function (field) {
    const column = mapping[field] + 1;
    return column >= firstColumn && column <= lastColumn;
  });
}

/* ================================ HTTP layer =============================== */

function props_() {
  const p = PropertiesService.getScriptProperties();
  const baseUrl = (p.getProperty('CRM_BASE_URL') || '').replace(/\/+$/, '');
  const secret = p.getProperty('SYNC_SHARED_SECRET') || '';
  if (!baseUrl || secret.length < 32) {
    throw new Error('Set Script properties CRM_BASE_URL and SYNC_SHARED_SECRET (32+ chars) first.');
  }
  return { baseUrl: baseUrl, secret: secret, store: p };
}

function call_(method, path, query, body) {
  const cfg = props_();
  const timestamp = String(Date.now());
  const queryString = query ? buildQuery_(query) : '';
  const payload = body ? JSON.stringify(body) : '';
  const signed = method === 'get' ? queryString : payload;
  const options = {
    method: method,
    muteHttpExceptions: true,
    headers: { 'x-sync-timestamp': timestamp, 'x-sync-signature': sign_(cfg.secret, timestamp, signed) },
  };
  if (method === 'post') { options.contentType = 'application/json'; options.payload = payload; }

  const url = cfg.baseUrl + path + (queryString ? '?' + queryString : '');
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  let json = null;
  try { json = JSON.parse(response.getContentText()); } catch (e) { /* non-JSON error page */ }
  if (code < 200 || code >= 300 || !json || json.success !== true) {
    const detail = json && (json.error || json.code) ? json.error || json.code : 'HTTP ' + code;
    throw new Error('CRM sync request failed (' + path + '): ' + detail);
  }
  return json;
}

/* ============================== sheet helpers ============================== */

function loadContext_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Tab "' + CONFIG.SHEET_NAME + '" not found. Change CONFIG.SHEET_NAME.');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const idx = function (title) { return headers.map(normalizeHeader_).indexOf(normalizeHeader_(title)); };
  const ctx = {
    sheet: sheet,
    headers: headers,
    mapping: mapHeaders_(headers, CONFIG.COLUMN_MAP),
    leadCol: idx(SPECIAL_HEADERS.LEAD_NUMBER),
    refCol: idx(SPECIAL_HEADERS.EXTERNAL_REF),
    statusCol: idx(SPECIAL_HEADERS.STATUS),
  };
  if (ctx.leadCol < 0 || ctx.refCol < 0 || ctx.statusCol < 0) {
    throw new Error('Run CRM Sync > "Set up sheet" first (adds the CRM columns).');
  }
  if (Object.keys(ctx.mapping).length === 0) throw new Error('No sheet headers matched CRM fields. Check header names.');
  return ctx;
}

function readRows_(ctx) {
  const firstDataRow = CONFIG.HEADER_ROW + 1;
  const count = ctx.sheet.getLastRow() - CONFIG.HEADER_ROW;
  if (count < 1) return [];
  const width = ctx.headers.length;
  const values = ctx.sheet.getRange(firstDataRow, 1, count, width).getValues();
  return values.map(function (row, i) {
    const lead = cellToText_(row[ctx.leadCol]);
    const ref = cellToText_(row[ctx.refCol]);
    return {
      rowIndex: firstDataRow + i, values: row, leadNumber: lead, externalRef: ref,
      key: lead || ref, fields: rowToFields_(ctx.mapping, row),
    };
  });
}

function hasContent_(fields) {
  return Object.keys(fields).some(function (f) { return fields[f] !== ''; });
}

function loadState_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(STATE_SHEET);
  const state = {};
  if (!sheet || sheet.getLastRow() < 1) return state;
  sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues().forEach(function (r) { if (r[0]) state[String(r[0])] = String(r[1]); });
  return state;
}

function saveState_(state) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(STATE_SHEET) || ss.insertSheet(STATE_SHEET);
  sheet.hideSheet();
  sheet.clearContents();
  const keys = Object.keys(state);
  if (keys.length) sheet.getRange(1, 1, keys.length, 2).setValues(keys.map(function (k) { return [k, state[k]]; }));
}

function setStatus_(ctx, rowIndex, text) {
  ctx.sheet.getRange(rowIndex, ctx.statusCol + 1).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM HH:mm') + ' · ' + text);
}

/** Write only cells whose value actually differs. Returns the row's resulting fields. */
function writeRecord_(ctx, rowIndex, record, currentValues) {
  const values = currentValues.slice();
  Object.keys(record).forEach(function (field) {
    const col = ctx.mapping[field];
    if (col === undefined) return; // column not in this sheet: leave alone
    const incoming = record[field] === null || record[field] === undefined ? '' : record[field];
    const outgoing = DATE_FIELDS.indexOf(field) !== -1 && incoming ? new Date(incoming) : incoming;
    if (sameValue_(field, values[col], outgoing)) return;
    try {
      ctx.sheet.getRange(rowIndex, col + 1).setValue(outgoing);
      values[col] = outgoing;
    } catch (e) {
      // The sheet refused this cell (e.g. a data-validation list or a protected range). Leave it as it is
      // rather than aborting the sync; the CRM keeps its own value.
    }
  });
  return rowToFields_(ctx.mapping, values);
}

/* ================================= setup =================================== */

function setupSheet() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { ui.alert('Tab "' + CONFIG.SHEET_NAME + '" not found. Edit CONFIG.SHEET_NAME in the script.'); return; }

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const normalized = headers.map(normalizeHeader_);
  let width = lastCol;
  ['LEAD_NUMBER', 'EXTERNAL_REF', 'STATUS'].forEach(function (k) {
    if (normalized.indexOf(normalizeHeader_(SPECIAL_HEADERS[k])) === -1) {
      width += 1;
      sheet.getRange(CONFIG.HEADER_ROW, width).setValue(SPECIAL_HEADERS[k]);
    }
  });

  const finalHeaders = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, width).getValues()[0];
  const mapping = mapHeaders_(finalHeaders, CONFIG.COLUMN_MAP);
  // Phone-like columns as plain text so "+91..." is never turned into a number or formula.
  const setupWarnings = [];
  ['phone', 'whatsappNumber'].forEach(function (f) {
    if (mapping[f] === undefined) return;
    try {
      sheet.getRange(CONFIG.HEADER_ROW + 1, mapping[f] + 1, sheet.getMaxRows() - CONFIG.HEADER_ROW, 1).setNumberFormat('@');
    } catch (e) {
      setupWarnings.push('⚠ Could not set "' + finalHeaders[mapping[f]] + '" to plain text (the column has a data-validation rule). Syncing still works; remove the rule under Data > Data validation if you want to add numbers freely.');
    }
  });
  const refIdx = finalHeaders.map(normalizeHeader_).indexOf(normalizeHeader_(SPECIAL_HEADERS.EXTERNAL_REF));
  sheet.hideColumns(refIdx + 1);

  const lines = SYNC_FIELDS.map(function (f) {
    return (mapping[f] !== undefined ? '✔ ' : '✘ ') + f + (mapping[f] !== undefined ? '  ←  "' + finalHeaders[mapping[f]] + '"' : '  (no matching column)');
  });
  if (mapping.fullName !== undefined) lines.unshift('✔ fullName (split into first + last name)  ←  "' + finalHeaders[mapping.fullName] + '"');
  // Text that merely LOOKS like a date (e.g. "10/12/2026") is ambiguous (US vs day-first), so flag it.
  const dataRows = sheet.getLastRow() - CONFIG.HEADER_ROW;
  const warnings = setupWarnings.slice();
  if (dataRows > 0) {
    DATE_FIELDS.forEach(function (f) {
      if (mapping[f] === undefined) return;
      const cells = sheet.getRange(CONFIG.HEADER_ROW + 1, mapping[f] + 1, dataRows, 1).getValues();
      const textCount = cells.filter(function (r) { return typeof r[0] === 'string' && r[0].trim() !== ''; }).length;
      if (textCount > 0) warnings.push('⚠ "' + finalHeaders[mapping[f]] + '" has ' + textCount + ' text value(s), not real dates. Select the column > Format > Number > Date time (or Date) first, or those rows will be rejected/misread.');
    });
  }
  ui.alert('Sheet ready', 'Column mapping (✘ columns are simply not synced):\n\n' + lines.join('\n') +
    (warnings.length ? '\n\n' + warnings.join('\n') : '') +
    '\n\nCheck that every ✔ points at the right column before the first sync.', ui.ButtonSet.OK);
}

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncOnEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  SpreadsheetApp.getUi().alert('Auto-sync is on (after data edits, with a 5-minute safety sync).');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const handler = t.getHandlerFunction();
    if (handler === 'syncNow' || handler === 'syncOnEdit') ScriptApp.deleteTrigger(t);
  });
}

/* ================================== sync =================================== */

function syncNow() { return runSync_(false); }
function syncOnEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  const ctx = loadContext_();
  if (!shouldSyncEdit_(sheet.getName(), range.getRow(), range.getLastRow(), range.getColumn(), range.getLastColumn(), ctx.mapping)) return;
  runSync_(false);
}
function syncConfirmMassChange() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Apply halted batch?',
    'Only continue if you checked that clearing those values is intended. Apply the blank cells to the CRM?', ui.ButtonSet.YES_NO);
  if (answer === ui.Button.YES) showSummary_(runSync_(true));
}
function syncNowInteractive() { showSummary_(runSync_(false)); }

function showSummary_(s) {
  SpreadsheetApp.getUi().alert('CRM sync finished',
    'Pushed: ' + s.pushed + '\nCreated: ' + s.created + '   Updated: ' + s.updated +
    '\nRejected: ' + s.rejected + '   To retry: ' + s.retry + '   Halted: ' + s.halted +
    '\nConflicts (CRM value kept): ' + s.conflicts + (s.notes.length ? '\n\n' + s.notes.join('\n') : ''), SpreadsheetApp.getUi().ButtonSet.OK);
}

function runSync_(confirmMassChange) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) return emptySummary_(['Another sync is running; skipped.']);
  try {
    const summary = emptySummary_([]);
    const ctx = loadContext_();
    const state = loadState_();
    pushPhase_(ctx, state, summary, confirmMassChange);
    saveState_(state);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function emptySummary_(notes) {
  return { pushed: 0, created: 0, updated: 0, rejected: 0, retry: 0, halted: 0, pulled: 0, skipped: 0, conflicts: 0, notes: notes };
}

/* ---- phase 1: sheet -> CRM ---- */

function pushPhase_(ctx, state, summary, confirmMassChange) {
  // Give every new, non-empty row its permanent External Ref BEFORE anything is sent.
  let rows = readRows_(ctx);
  rows.forEach(function (r) {
    if (!r.leadNumber && !r.externalRef && hasContent_(r.fields)) {
      ctx.sheet.getRange(r.rowIndex, ctx.refCol + 1).setValue(newRef_(r.fields));
    }
  });
  SpreadsheetApp.flush();
  rows = readRows_(ctx);

  const changed = rows.filter(function (r) {
    return r.key && hasContent_(r.fields) && hashFields_(r.fields) !== state[r.key];
  });
  summary.pushed = changed.length;

  for (let i = 0; i < changed.length; i += CONFIG.BATCH_SIZE) {
    const chunk = changed.slice(i, i + CONFIG.BATCH_SIZE);
    const body = {
      batchId: Utilities.getUuid(),
      confirmMassChange: confirmMassChange === true,
      rows: chunk.map(function (r) {
        const row = { rowRef: r.key, fields: r.fields };
        // Send both when present: if the CRM does not know this lead number (e.g. the sheet was
        // synced to another database before), the stable externalRef lets it re-create the lead.
        if (r.leadNumber) row.leadNumber = r.leadNumber;
        if (r.externalRef) row.externalRef = r.externalRef;
        return row;
      }),
    };
    const response = call_('post', '/api/sync/sheet/push', null, body).data;
    if (response.status === 'halted') summary.notes.push('HALTED: ' + response.haltReason);
    applyPushResults_(ctx, state, summary, chunk, response);
  }
}

function applyPushResults_(ctx, state, summary, sentRows, response) {
  // Re-read so we write to the row's CURRENT position (rows may have been sorted/inserted meanwhile).
  const current = readRows_(ctx);
  const byKey = {};
  current.forEach(function (r) { if (r.key) byKey[r.key] = r; if (r.externalRef) byKey[r.externalRef] = r; });
  const sentHash = {};
  sentRows.forEach(function (r) { sentHash[r.key] = hashFields_(r.fields); });

  response.rows.forEach(function (result) {
    const row = byKey[result.rowRef];
    if (!row) return; // row moved/deleted by a person: it will be re-evaluated next run
    summary[result.status] = (summary[result.status] || 0) + 1;

    if (result.status === 'rejected' || result.status === 'retry' || result.status === 'halted') {
      setStatus_(ctx, row.rowIndex, (result.status === 'rejected' ? 'REJECTED: ' : result.status === 'retry' ? 'WILL RETRY: ' : 'HALTED: ') + (result.reason || ''));
      // A rejected row is remembered so it is not re-sent until someone edits it; retry/halted are re-sent.
      if (result.status === 'rejected') state[row.key] = sentHash[result.rowRef];
      return;
    }

    // created / updated / unchanged
    // Also overwrite a stale number: the CRM may have issued a new one for this row.
    if (result.leadNumber && result.leadNumber !== row.leadNumber) ctx.sheet.getRange(row.rowIndex, ctx.leadCol + 1).setValue(result.leadNumber);
    const fields = result.record ? writeRecord_(ctx, row.rowIndex, result.record, row.values) : row.fields;
    const newKey = result.leadNumber || row.key;
    if (newKey !== row.key) delete state[row.key];
    state[newKey] = hashFields_(fields);

    let note = result.status === 'created' ? 'Created ' + result.leadNumber : 'Synced';
    if (result.conflicts && result.conflicts.length) {
      summary.conflicts += result.conflicts.length;
      note = 'CONFLICT – CRM value kept for: ' + result.conflicts.map(function (c) {
        return c.field + ' (yours: "' + (c.sheetValue === null ? '' : c.sheetValue) + '" is saved in the CRM)';
      }).join('; ');
    }
    setStatus_(ctx, row.rowIndex, note);
  });
}

/* ---- phase 2: CRM -> sheet ---- */

function pullPhase_(ctx, state, summary) {
  const store = PropertiesService.getScriptProperties();
  let cursor = store.getProperty('PULL_CURSOR') || '';
  let fresh = true;

  for (let page = 0; page < CONFIG.MAX_PULL_PAGES; page++) {
    const result = call_('get', '/api/sync/sheet/pull', { cursor: cursor, limit: 100, fresh: fresh ? '1' : '0' }, null).data;
    fresh = false;

    const rows = readRows_(ctx);
    const byLead = {};
    rows.forEach(function (r) { if (r.leadNumber) byLead[r.leadNumber] = r; });
    const acks = [];

    result.items.forEach(function (item) {
      const existing = byLead[item.leadNumber];
      if (existing) {
        // Only overwrite a row if it is exactly what we last synced. Otherwise a person has
        // an unsent edit: leave it; the next push merges it safely with the CRM change.
        if (state[item.leadNumber] !== hashFields_(existing.fields)) { summary.skipped += 1; return; }
        const fields = writeRecord_(ctx, existing.rowIndex, item.record, existing.values);
        state[item.leadNumber] = hashFields_(fields);
        if (item.archived) setStatus_(ctx, existing.rowIndex, 'Archived in CRM'); else if (hashFields_(fields) !== hashFields_(existing.fields)) setStatus_(ctx, existing.rowIndex, 'Updated from CRM');
      } else {
        const newRow = ctx.sheet.getLastRow() + 1;
        const blank = new Array(ctx.headers.length).fill('');
        const fields = writeRecord_(ctx, newRow, item.record, blank);
        ctx.sheet.getRange(newRow, ctx.leadCol + 1).setValue(item.leadNumber);
        state[item.leadNumber] = hashFields_(fields);
        setStatus_(ctx, newRow, item.archived ? 'Archived in CRM' : 'Added from CRM');
      }
      summary.pulled += 1;
      acks.push({ leadNumber: item.leadNumber, hash: item.hash });
    });

    for (let i = 0; i < acks.length; i += 500) {
      call_('post', '/api/sync/sheet/ack', null, { items: acks.slice(i, i + 500) });
    }

    // Persist the cursor only after this page was written and acked.
    if (result.nextCursor) { cursor = result.nextCursor; store.setProperty('PULL_CURSOR', cursor); }
    if (!result.hasMore) break;
  }
}

/* ============================== diagnostics ================================ */

function showServerStatus() {
  const ui = SpreadsheetApp.getUi();
  try {
    const d = call_('get', '/api/sync/sheet/status', {}, null).data;
    const m = d.mirror || {};
    ui.alert('CRM sync status',
      'Live leads in CRM: ' + d.liveLeads + '\nArchived: ' + d.archivedLeads +
      '\nOpen conflicts to review: ' + d.openConflicts + '\nRejected rows (24h): ' + d.rejectedLast24h +
      '\nLast batch: ' + (d.lastBatch ? d.lastBatch.status + ' @ ' + d.lastBatch.createdAt : 'none') +
      '\nFirestore mirror: ' + (m.configured === false ? 'not configured' : m.error ? 'ERROR – ' + m.error :
        (m.missingInFirestore.length + m.outdatedInFirestore.length) + ' record(s) out of date'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Could not reach the CRM', String(e.message || e), ui.ButtonSet.OK);
  }
}

// ---------- Website sign-up form ----------

const NOTIFY = 'khushi@getauradeck.com';
const SIGNUP_URL = 'https://app.getauradeck.com/sign-in';
const REPLY_TO = 'khushi@getauradeck.com';
const SENDER_NAME = 'Khushi from AuraDeck';

function doPost(e) {
  const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const email = String(data.email || '').trim();

  if (data.website || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false });
  }

  const book = SpreadsheetApp.getActiveSpreadsheet();
  book.getSheets()[0].appendRow([new Date(), email, String(data.source || ''), false]);

  MailApp.sendEmail(NOTIFY, 'New early-access sign-up: ' + email,
    email + ' signed up from the ' + (data.source || 'site') + ' form.\n\n' +
    'Reply within a day with their login.\n' + book.getUrl());

  return json({ ok: true });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Beta invites ----------

function norm(s) {
  return String(s).replace(/[\s\u00A0]+/g, ' ').trim().toLowerCase();
}

function inviteBody(code) {
  return `Hi there,

Thank you for joining the AuraDeck beta. We're really glad to have you.

Your invite code: ${code}
(It's personal to you, so please don't share it.)

To get started:
1. Go to ${SIGNUP_URL}
2. Sign up with the email address this invite was sent to
3. Enter your invite code when prompted
4. Connect your Google Calendar so your sessions stay in sync

This is a beta, so you may run into a few rough edges. If anything breaks or you have feedback, just reply to this email. It comes straight to me.

Warmly,
Khushi Agarwal
Founder, AuraDeck
getauradeck.com`;
}

function sendInvites() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(norm);
  const col = name => headers.indexOf(norm(name)) + 1;

  const emailCol = col('Email'), codeCol = col('Invite code'), sentCol = col('Invited at');
  if (!emailCol || !codeCol || !sentCol) {
    throw new Error('Need Email, Invite code and Invited at columns in row 1. Found: ' + headers.join(' | '));
  }

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const invited = new Set(
    sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
      .filter(row => row[sentCol - 1])
      .map(row => norm(row[emailCol - 1]))
  );

  const range = sheet.getActiveRange();
  let sent = 0, skipped = 0;

  for (let r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) {
    if (r === 1 || sheet.getRange(r, sentCol).getValue()) continue;

    const email = String(sheet.getRange(r, emailCol).getValue()).trim();
    if (!email) continue;
    if (invited.has(norm(email))) { skipped++; continue; }

    const code = sheet.getRange(r, codeCol).getValue() || newCode();
    GmailApp.sendEmail(email, 'Your AuraDeck beta invite code', inviteBody(code), {
      name: SENDER_NAME,
      replyTo: REPLY_TO,
    });

    sheet.getRange(r, codeCol).setValue(code);
    sheet.getRange(r, sentCol).setValue(new Date());
    invited.add(norm(email));
    sent++;
  }

  ui.alert(`Sent ${sent} invite(s).` + (skipped ? ` Skipped ${skipped} duplicate(s).` : ''));
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'AURA-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
