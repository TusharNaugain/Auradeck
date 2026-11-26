-- Brand name is "Auradeck" everywhere. Undo the old "Auradesk" spelling in the enum and in the
-- internal organisation / bootstrap admin rows. Safe to run more than once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrganisationType' AND e.enumlabel = 'AURADESK_INTERNAL'
  ) THEN
    ALTER TYPE "OrganisationType" RENAME VALUE 'AURADESK_INTERNAL' TO 'AURADECK_INTERNAL';
  END IF;
END $$;

UPDATE "organisations" SET "slug" = 'auradeck-internal'
WHERE "slug" = 'auradesk-internal'
  AND NOT EXISTS (SELECT 1 FROM "organisations" WHERE "slug" = 'auradeck-internal');

UPDATE "organisations" SET "legalName" = 'Auradeck' WHERE "legalName" = 'Auradesk';
UPDATE "organisations" SET "displayName" = 'Auradeck' WHERE "displayName" = 'Auradesk';

UPDATE "users" SET "firstName" = 'Auradeck' WHERE "firstName" = 'Auradesk';
UPDATE "users" SET "fullName" = 'Auradeck Admin' WHERE "fullName" = 'Auradesk Admin';
