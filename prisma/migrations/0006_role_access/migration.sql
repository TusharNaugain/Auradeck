-- Per-member visibility override (null = role default)
ALTER TABLE "memberships" ADD COLUMN "scopeOverride" "ScopeType";

-- Per-organisation customised role access
CREATE TABLE "org_role_policies" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordScope" "ScopeType" NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_role_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_role_policies_organisationId_roleId_key" ON "org_role_policies"("organisationId", "roleId");

ALTER TABLE "org_role_policies" ADD CONSTRAINT "org_role_policies_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_role_policies" ADD CONSTRAINT "org_role_policies_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
