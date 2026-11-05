FROM node:20-slim

WORKDIR /app

# Install openssl for Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install all dependencies (clean Linux install)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Copy application source code
COPY . .

# Set build-time defaults so Prisma and Next.js build never crash
ENV NODE_ENV=production
ENV NEXT_PHASE=phase-production-build
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/placeholder?schema=public"
ENV SESSION_SECRET="3ba656f3d7c696839825a8fbae6254d6925573c2471d1899a2b1df3c9476f5b3"
ENV IRON_SESSION_PASSWORD="0134edcc87feea06429e07f15dae2828377c0e0b80146f17098362c9b046efe6"
ENV NEXT_PUBLIC_APP_URL="https://auradeck-production.up.railway.app"
ENV NEXT_PUBLIC_APP_NAME="AuraDeck CRM"

# Generate Prisma Client & Build Next.js
RUN npx prisma generate
RUN npx next build

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
