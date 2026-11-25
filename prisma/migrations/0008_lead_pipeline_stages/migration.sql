-- 8-stage lead pipeline (owner playbook) + "Next action" + extra contacts on leads.
-- Non-destructive: every existing lead keeps a stage, mapped as below (mirrors
-- LEGACY_STAGE_MAP in src/lib/leads/stages.ts). Old reasons (lostReason /
-- disqualificationReason) are kept untouched.
--   NEW → NEW (inbox)              CONTACTED → CONTACTED
--   QUALIFIED → INTERESTED         DEMO_BOOKED → DEMO_SCHEDULED
--   PROPOSAL_SENT → DEMO_ATTENDED  NEGOTIATION → DEMO_ATTENDED
--   CONVERTED → SIGNED_UP          LOST → LOST ("Dead")
--   DISQUALIFIED → LOST ("Dead")

CREATE TYPE "LeadLifecycleStage_new" AS ENUM (
  'NEW', 'CONTACTED', 'INTERESTED', 'DEMO_SCHEDULED', 'DEMO_ATTENDED',
  'SIGNED_UP', 'ACTIVATED', 'PAID', 'CHURNED', 'LOST'
);

ALTER TABLE "leads" ALTER COLUMN "lifecycleStage" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "lifecycleStage" TYPE "LeadLifecycleStage_new" USING (
  CASE "lifecycleStage"::text
    WHEN 'QUALIFIED' THEN 'INTERESTED'
    WHEN 'DEMO_BOOKED' THEN 'DEMO_SCHEDULED'
    WHEN 'PROPOSAL_SENT' THEN 'DEMO_ATTENDED'
    WHEN 'NEGOTIATION' THEN 'DEMO_ATTENDED'
    WHEN 'CONVERTED' THEN 'SIGNED_UP'
    WHEN 'DISQUALIFIED' THEN 'LOST'
    ELSE "lifecycleStage"::text
  END
)::"LeadLifecycleStage_new";
ALTER TABLE "leads" ALTER COLUMN "lifecycleStage" SET DEFAULT 'NEW';

DROP TYPE "LeadLifecycleStage";
ALTER TYPE "LeadLifecycleStage_new" RENAME TO "LeadLifecycleStage";

-- What the lead owner plans to do next ("Send pricing", "Demo reminder"...).
ALTER TABLE "leads" ADD COLUMN "nextAction" TEXT;
-- Contacts added by the team on top of the source email/phone (which stay read-only):
-- [{ id, type: phone|email|whatsapp|linkedin|instagram|facebook|twitter|website|other, value, label?, addedAt, addedBy }]
ALTER TABLE "leads" ADD COLUMN "extraContacts" JSONB NOT NULL DEFAULT '[]';
