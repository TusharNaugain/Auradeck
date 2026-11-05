/**
 * Units under test import modules that create a PrismaClient at module scope
 * (`@/lib/db`), so a datasource URL has to exist. No query is ever issued here:
 * client construction is lazy about connections.
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/auradeck_test'
process.env.IRON_SESSION_PASSWORD ??= '0123456789abcdef0123456789abcdef'
