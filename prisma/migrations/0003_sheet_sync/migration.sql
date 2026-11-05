-- CreateTable
CREATE TABLE "sync_record_states" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "externalRef" TEXT,
    "baseJson" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_record_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_batches" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "rawPayload" JSONB NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "crmValue" JSONB,
    "sheetValue" JSONB,
    "winner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_rejected_rows" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowRef" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawRow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_rejected_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_record_states_organisationId_idx" ON "sync_record_states"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_record_states_organisationId_entity_recordId_key" ON "sync_record_states"("organisationId", "entity", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_record_states_organisationId_entity_externalRef_key" ON "sync_record_states"("organisationId", "entity", "externalRef");

-- CreateIndex
CREATE INDEX "sync_batches_organisationId_createdAt_idx" ON "sync_batches"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_batches_organisationId_batchId_key" ON "sync_batches"("organisationId", "batchId");

-- CreateIndex
CREATE INDEX "sync_conflicts_organisationId_status_idx" ON "sync_conflicts"("organisationId", "status");

-- CreateIndex
CREATE INDEX "sync_conflicts_recordId_idx" ON "sync_conflicts"("recordId");

-- CreateIndex
CREATE INDEX "sync_rejected_rows_organisationId_createdAt_idx" ON "sync_rejected_rows"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_rejected_rows_batchId_idx" ON "sync_rejected_rows"("batchId");

