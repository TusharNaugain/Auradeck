-- Therapist record: product usage, trial, conversion, feedback and outcome on the lead.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "signedUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "demoStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "demoAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstLoginAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstClientAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstSessionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trialStartAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "planOffered" TEXT,
  ADD COLUMN IF NOT EXISTS "willingnessToPay" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "objections" TEXT,
  ADD COLUMN IF NOT EXISTS "featureRequests" TEXT,
  ADD COLUMN IF NOT EXISTS "outcome" TEXT;

-- Backfill what the pipeline already tells us.
UPDATE "leads" SET "demoStatus" = 'scheduled' WHERE "demoStatus" IS NULL AND "lifecycleStage" = 'DEMO_SCHEDULED';
UPDATE "leads" SET "demoStatus" = 'attended' WHERE "demoStatus" IS NULL AND "lifecycleStage" IN ('DEMO_ATTENDED', 'SIGNED_UP', 'ACTIVATED', 'PAID');
UPDATE "leads" SET "outcome" = 'paid', "paymentStatus" = COALESCE("paymentStatus", 'paid') WHERE "outcome" IS NULL AND "lifecycleStage" = 'PAID';
UPDATE "leads" SET "outcome" = 'lost' WHERE "outcome" IS NULL AND "lifecycleStage" IN ('CHURNED', 'LOST');

CREATE INDEX IF NOT EXISTS "leads_trialEndsAt_idx" ON "leads" ("trialEndsAt");
