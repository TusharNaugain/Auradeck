-- Link a lead to the deal (opportunity) created for it when it reaches "Demo scheduled".
-- Additive and nullable: existing leads are untouched.
ALTER TABLE "leads" ADD COLUMN "opportunityId" TEXT;
CREATE INDEX "leads_opportunityId_idx" ON "leads"("opportunityId");
ALTER TABLE "leads" ADD CONSTRAINT "leads_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
