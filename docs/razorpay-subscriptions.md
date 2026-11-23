# Razorpay subscriptions — setup & test-mode checklist

Therapist practices pay Auradeck for a plan through Razorpay Subscriptions.
Therapist-client invoices, UPI QR, bank transfer and manual payments are **unchanged**.

## How it works

1. A practice opens **Plans & billing** (`/billing/plan`). The first visit starts a 14-day free trial.
2. They choose **Auradeck Pro** — ₹999/month or ₹9,990/year, GST included (`plans` row `auradeck-pro`).
3. The server creates the Razorpay plan (once per test/live mode) and a subscription, then opens Razorpay Checkout.
4. After payment, the server checks `HMAC_SHA256(payment_id|subscription_id, key_secret)` and pulls the latest status from Razorpay.
5. The signed webhook (`/api/webhooks/razorpay`) is the source of truth for activation, renewals, failures and cancellation. Each event id is processed only once.

| Razorpay status | Auradeck status | Access |
|---|---|---|
| created | CREATED | trial continues |
| authenticated / active | AUTHENTICATED / ACTIVE | full |
| pending (renewal failed) | PAST_DUE | full for 7 more days (grace); Razorpay retries |
| halted | HALTED | read-only |
| cancelled | CANCELLED | full until the paid period ends, then read-only |
| completed / expired | COMPLETED / EXPIRED | read-only |

"Read-only" means the practice can still view everything, but any change (except billing) returns `402 SUBSCRIPTION_REQUIRED`.
Practices can cancel themselves. Upgrade/downgrade is not built yet.

## Environment variables

| Variable | What it is |
|---|---|
| `BILLING_RAZORPAY_ENABLED` | `true` turns the feature on. Keep `false` in production until the test-mode checks pass. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Account & Settings → API Keys. Use **Test Mode** keys (`rzp_test_…`). |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you type when creating the webhook. |
| `BILLING_CRON_SECRET` | 32+ characters. A daily job sends `POST /api/webhooks/billing-trial-reminders` with `Authorization: Bearer <secret>` to email practices 3 days before their trial ends. |

Never commit these values. Put them in `.env` locally and in Railway variables for production.

## Local test-mode run

1. Put the test keys in `.env` and set `BILLING_RAZORPAY_ENABLED=true`. Restart `npm run dev`.
2. `npx prisma migrate deploy` (already applied to the local `crm_staging` DB).
3. Sign in as a **practice owner** (not the Auradeck team workspace). Open **Plans & billing** and click **Subscribe**.
4. Pay with a Razorpay test card or test UPI ID from https://razorpay.com/docs/payments/payments/test-card-upi-details/
5. The page should show "Payment received — your plan is active", and the payment should appear in Payment history.

Webhooks cannot reach `localhost`. Locally, activation happens through the verified checkout step. To test webhooks, use the Railway staging/production URL. Razorpay Dashboard → Webhooks → Add:
- URL: `https://<domain>/api/webhooks/razorpay`
- Secret: same as `RAZORPAY_WEBHOOK_SECRET`
- Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`, `payment.failed`

Every webhook is stored in the `billing_events` table (status `processed` / `ignored` / `failed`), so you can review them for reconciliation.

## Go-live gate (from the deck)

Before setting `BILLING_RAZORPAY_ENABLED=true` with live keys, check in test mode:

- [ ] Subscribe monthly and yearly → status ACTIVE, payment recorded.
- [ ] Failed test payment → failure message, no access change.
- [ ] Webhook delivered → `billing_events` row is `processed`. Re-delivering the same event → no change.
- [ ] Cancel → "Access until …" shown. After the period ends, the workspace is read-only.
- [ ] Trial ended without a plan → edits blocked, billing page still works.
