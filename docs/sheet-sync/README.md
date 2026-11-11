# Sheet → CRM lead sync

Sheet edits are pushed to the CRM over signed HTTP; the sheet never holds database
credentials. This integration does not pull CRM changes back into the sheet.

## One-time setup

1. Back up Postgres and (if used) Firestore before the first sync.
2. Apply the migration: `npx prisma migrate deploy` (adds `sync_*` tables only).
3. Set in `.env`: `SYNC_SHARED_SECRET` (≥32 chars), `SYNC_ORGANISATION_ID`, optionally `SYNC_CONFLICT_WINNER` (`crm` default, or `sheet`).
4. Install the sheet script (see below) and put the same secret in its Script properties (never in a cell).
5. "Set up sheet" in the script adds the CRM columns for you (Lead number, External ref, Sync status).

## Install the sheet script ([Code.gs](./Code.gs))

> **Do this on a COPY of the sheet first** (File → Make a copy), with test leads.

1. In the sheet: **Extensions → Apps Script**, delete the sample code, paste all of `Code.gs`, save.
2. If your tab is not called `Leads`, change `CONFIG.SHEET_NAME` at the top.
3. **Project Settings → Script properties** → add:
   - `CRM_BASE_URL` — your CRM's public URL, e.g. `https://crm.example.com` (must be reachable from the internet; `localhost` will not work from Google)
   - `SYNC_SHARED_SECRET` — exactly the same value as `SYNC_SHARED_SECRET` in the CRM `.env`
4. Reload the sheet, then **CRM Sync → Set up sheet**. It adds three columns (*CRM Lead Number*, *CRM External Ref* (hidden), *CRM Sync Status*), makes phone columns plain text, and shows a **column mapping report**. Check every ✔ points at the right column. Unmatched columns (✘) are simply never touched.
5. **CRM Sync → Check connection & server status** should show live lead counts, not an error.
6. **CRM Sync → Sync now**, then read the *CRM Sync Status* column.
7. Only when the dry run looks right: **Turn on auto-sync (on edit + 5-min safety)**. Mapped data edits sync immediately; the five-minute timer also catches changes if an edit-trigger run is delayed or fails.

### Dry-run checklist (on the copy)

| Try this | Expect |
| --- | --- |
| Add a row with a name + email | Gets a `LD-…` number; status says *Created* |
| Click *Sync now* twice | No duplicate lead in the CRM |
| Edit a cell in the sheet | CRM updates after the next sync |
| Edit a *different* field in the CRM, then sync | Sheet picks it up; your sheet edit is still there |
| Edit the *same* cell on both sides | Status says *CONFLICT*, CRM value kept, your value saved in `sync_conflicts` |
| Add a row with an email that already exists | *REJECTED: Duplicate of LD-…* (to link it, type that number in *CRM Lead Number*) |
| Clear a whole column, then sync | Batch *HALTED*, nothing changed in the CRM |
| Archive a lead in the CRM | Row stays, status *Archived in CRM*, never deleted |

### Behaviour worth knowing

- The script never deletes rows. Sorting or inserting rows is safe (rows are matched by lead number / external ref, not by position).
- If you edit a row between two syncs, the CRM's change to that row waits: your edit is pushed first and merged field-by-field.
- Do not edit the hidden *CRM External Ref* column or the hidden `_CRM_SYNC_STATE` tab.
- Rows pulled from the CRM that the sheet has no column for are not lost; they stay in the CRM.
- Rows with a *Rejected* status are not re-sent until you edit them.

## Request signing

Every request carries:

- `x-sync-timestamp`: `Date.now()` in ms (must be within 5 min of the server clock)
- `x-sync-signature`: hex HMAC-SHA256 of `"<timestamp>.<payload>"` with the shared secret

`payload` is the **exact raw JSON body** for POST, or the **query string without `?`** for GET.

## Run order

1. **Push** mapped sheet edits → `POST /api/sync/sheet/push`.
2. Write the CRM response back to the row for its lead number, status, and any CRM-wins conflict correction.

## Push body

```json
{
  "batchId": "unique-per-run-≥8-chars",
  "confirmMassChange": false,
  "rows": [
    { "rowRef": "sheet row id", "leadNumber": "LD-000012", "fields": { "city": "Mumbai" } },
    { "rowRef": "sheet row id", "externalRef": "uuid-for-new-rows", "fields": { "firstName": "Casey", "email": "c@x.com" } }
  ]
}
```

Send only columns that exist in the sheet. **An omitted column is left untouched; an empty string clears it.**
Synced fields: `firstName, lastName, email, phone, whatsappNumber, organisationName, jobTitle, city, state, leadSource, lifecycleStage, nextFollowUpAt, painPoints, useCase`.

Per-row `status`: `created | updated | unchanged | rejected | retry | halted`.
Re-send `retry` rows; fix `rejected` rows (reason is returned and stored in `sync_rejected_rows`).

## What protects the data

| Risk | Safeguard |
| --- | --- |
| Lost edit when both sides change different fields | Field-level 3-way merge against the last agreed state |
| Both sides change the same field | One side wins by policy; the other value is saved in `sync_conflicts` |
| Retry / double send | `batchId` replays the stored result; `externalRef` makes creates idempotent |
| Column shift or empty export wiping data | Batch halts untouched if >30% of rows (min 5) would clear values; re-send with `confirmMassChange` after review |
| CRM edited while sync runs | Compare-and-set on `updatedAt`; loser writes nothing and returns `retry` |
| Deletion | Never hard-deleted; archived leads are pulled as `archived:true` and cannot be edited from the sheet |
| Bad data | Validated with the CRM's rules; rejections stored with the original row |
| Forensics | Raw batch stored first; every change written to `audit_logs` in the same transaction |
| Forged / replayed requests | HMAC + 5-minute window; fails closed if no secret is set |
| Firestore outage | Mirror is best-effort and never blocks a sync; `GET /api/sync/sheet/status?repair=1` rebuilds it from Postgres |

## Monitoring

`GET /api/sync/sheet/status` (signed) reports live/archived lead counts, open conflicts,
rejects in the last 24 h, the last batch, and Postgres-vs-Firestore drift. Review
`sync_conflicts` (status `open`) regularly.

## Known limits

- Leads only (tags, custom fields, notes/activities and other entities are not synced yet).
- Phone numbers compare as stored; `9821522165` and `+919821522165` are treated as different values.
- Conflict review is by table today; there is no UI yet.

## Your sheet: "Auradeck early access" (Sheet1)

The script is pre-configured for this sheet (`SHEET_NAME: 'Sheet1'`). How each column behaves:

| Sheet column | Stored in the CRM as | Notes |
| --- | --- | --- |
| Timestamp | custom field `signedUpAt` | Must be a real date/time cell (Format → Number → Date time) |
| Email | lead email | Identifies the lead; duplicates are rejected, not merged |
| Source | custom field `waitlistSource` (text kept exactly as typed) | The CRM's lead source is *derived once, at creation*: `hero` → Website, `survey` → Campaign, `refferal`/`referral` → Referral, anything else → Other |
| Contacted | derived from lead stage | `YES` moves a **New** lead to **Contacted**. `No`/`FALSE`/blank = not contacted. It only moves forward: a `No` never demotes a lead, and any lead past New shows `YES` |
| Invite code, Invited at, Trial Started | custom fields | Two-way. Dates must be real date cells |
| LinkedIn | custom field `linkedin` | `na` / `n/a` count as empty |
| Whats App | custom field `whatsappOptIn` (yes/no) | A flag, **not** a phone number. If it should hold numbers, rename the header to `WhatsApp number` |

There is no name column, so a new lead's name is the **email prefix** (e.g. `kanupriyamody`) until someone
edits it in the CRM. To use a real name instead, add a `First name` column to the sheet.

### First sync on this sheet

- The 21 existing rows get *CRM Lead Number* values as they are created. Run it on a **copy** first.
- Row 18 has a name (`Nayana singh`) in the Email column and no timestamp: it will show **REJECTED: invalid email**.
  Fix the cell and it syncs on the next run.
- If these people already exist in the CRM, their rows show **REJECTED: Duplicate of LD-…**. Type that lead number
  into *CRM Lead Number* to link the row, instead of creating a second lead.
- Custom fields are saved inside each lead's existing `customFields` data, so **no extra migration** is needed.

## Beta Tracker sheet ([BetaTracker.gs](./BetaTracker.gs))

`BetaTracker.gs` is `Code.gs` without the website sign-up form and the invite e-mail sender, set up for the
`auradeck_beta_tracker` sheet's **Beta Tracker** tab, plus an intro e-mail sender. Nothing is e-mailed automatically: only **Email > Send intro e-mails to new rows** sends, after a confirmation, to rows with an email and an empty *Email Sent* column (the script adds that column and writes `Sent`). Install it the same way as above (Extensions > Apps Script,
Script properties `CRM_BASE_URL` and `SYNC_SHARED_SECRET`, then **CRM Sync > Set up sheet** and **Sync now**).

- `Name` is split into first + last name (a blank name is never sent, so it cannot clear a CRM name).
- `Phone / WhatsApp` -> phone; bare 10-digit numbers become `+91...` (`CONFIG.PHONE_COUNTRY_CODE`).
- `Lead Source` -> the free-text source (`waitlistSource`). A new lead whose source starts with "Hot" starts as **Priority reachout**.
- `Notes` -> pain points, `Clinic / Solo` -> use case. Other columns (status, dates, tier, MRR) are not synced.
- A new row's External Ref is `beta-tracker-<email>` (`CONFIG.REF_PREFIX`), the same one used for the one-time import, so the
  first sync links existing rows to their `LD-` numbers instead of rejecting them. A row whose email/phone already belongs to a
  lead from another sheet shows *REJECTED: Duplicate of LD-...*; type that number into *CRM Lead Number* to link it.

