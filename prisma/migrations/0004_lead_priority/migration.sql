-- Priority reachout flag on leads (manual toggle in the CRM).
ALTER TABLE "leads" ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "leads_organisationId_isPriority_idx" ON "leads"("organisationId", "isPriority");
