-- Rename the internal organisation type from AURADECK_INTERNAL to AURADESK_INTERNAL
-- to match prisma/schema.prisma and the application code.
-- Safe to run more than once: it only renames when the old value still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrganisationType' AND e.enumlabel = 'AURADECK_INTERNAL'
  ) THEN
    ALTER TYPE "OrganisationType" RENAME VALUE 'AURADECK_INTERNAL' TO 'AURADESK_INTERNAL';
  END IF;
END $$;
