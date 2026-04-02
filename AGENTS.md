# Viet-ERP — Agent Instructions

## Project Overview
Viet-ERP is a monorepo ERP ecosystem for Vietnamese manufacturing companies.
- **Monorepo tool**: Turborepo
- **16 apps** in `apps/` (Next.js, NestJS)  
- **27 shared packages** in `packages/`
- **Database**: PostgreSQL via Prisma 7 (driver adapter pattern)
- **Language**: TypeScript 5.9+, Node.js 20+

## Key Architecture
- `packages/database` — Prisma 7 schema + client (core dependency)
- `packages/shared` — Shared types and utilities
- `apps/HRM-unified` — Main HRM app (Next.js 15)
- `apps/TPM-api-nestjs` — NestJS API server
- `apps/landing-page` — Public landing page

## Development Commands
```bash
npm install --legacy-peer-deps   # Install deps (monorepo)
npx turbo run build              # Build all apps
npx turbo run test               # Test all apps
npx turbo run lint               # Lint all apps
npx turbo run typecheck          # TypeScript check
```

## Database Setup (Prisma 7)
```bash
# From packages/database/
npx prisma generate              # Generate Prisma client
npx prisma db push               # Push schema to DB
npx prisma validate              # Validate schema
```

**Prisma 7 Breaking Changes Applied:**
- `url` removed from `datasource` block in schema.prisma
- Config in `prisma.config.ts` (loads .env automatically)
- Client uses `@prisma/adapter-pg` driver adapter
- `PrismaClient` requires adapter in constructor

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_SECRET` — Auth secret
- `NODE_ENV` — development/production

## CI/CD
- GitHub Actions: `.github/workflows/ci.yml`
- Jobs: lint → typecheck → test → build → docker-build → docker-push

## Fix Priority
1. Make `npx turbo run build` pass (all 16 apps)
2. Make `npx turbo run test` pass
3. Fix TypeScript errors across packages
4. Add missing test files for untested apps
