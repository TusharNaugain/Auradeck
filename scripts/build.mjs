import { execSync } from 'child_process'

// Ensure dummy fallback build-time env vars exist so prisma generate and next build don't fail during container build
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/placeholder?schema=public'
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = '3ba656f3d7c696839825a8fbae6254d6925573c2471d1899a2b1df3c9476f5b3'
}
if (!process.env.IRON_SESSION_PASSWORD) {
  process.env.IRON_SESSION_PASSWORD = '0134edcc87feea06429e07f15dae2828377c0e0b80146f17098362c9b046efe6'
}

process.env.NEXT_PHASE = 'phase-production-build'

console.log('📦 [1/2] Generating Prisma Client...')
try {
  execSync('npx prisma generate', { stdio: 'inherit', env: process.env })
} catch (err) {
  console.error('Prisma generation failed:', err)
  process.exit(1)
}

console.log('🚀 [2/2] Running Next.js Build...')
try {
  execSync('npx next build', { stdio: 'inherit', env: process.env })
} catch (err) {
  console.error('Next.js build failed:', err)
  process.exit(1)
}
