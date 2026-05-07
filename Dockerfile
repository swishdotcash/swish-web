FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files, .npmrc (legacy-peer-deps), and postinstall script
COPY package.json package-lock.json* .npmrc* ./
COPY scripts ./scripts

# Install dependencies (postinstall patches privacycash). PC SDK requires
# --legacy-peer-deps; flag set explicitly as belt-and-suspenders with .npmrc.
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for Next.js public env vars (must be available at build time)
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_RPC_URL
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone output (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy privacycash circuit files (WASM and zkey for ZK proofs)
COPY --from=builder /app/node_modules/privacycash ./node_modules/privacycash

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run standalone server directly
CMD ["node", "server.js"]
