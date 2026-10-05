# Arya Tarray

Arya Tarray is an internal operations dashboard for Yayasan Arya Tarray Nusantara. It supports bank-statement intake, reconciliation, approval, donor records, program allocation, and monitoring. The application handles financial and donor information; use authorized accounts and protect local configuration and exported data.

## Current workflows

- Authentication, active-user checks, role/menu authorization, and configuration of users, roles, event codes, approvals, and bank accounts.
- BCA statement upload; `RAW → CHECK → FINALIZED` reconciliation; transaction inquiry; Edit Income corrections and ANY-ONE Sign Approval.
- Donor registration and canonical `BankTransaction → MemberIdentity → Member` ownership, including identity history and donation history.
- STANDARD direct contributions, TIME_BASED subscriptions/coverage, CAMPAIGN participation/allocation, carry balances, transfer/reversal ledgers, and read-only monitoring.

## Stack and layout

The frontend is Next.js 15, React 19, and TypeScript in `frontend/src/`. The backend is Express 5, TypeScript, Prisma 6, and MySQL 8.4 in `backend/src/`. Root npm workspaces coordinate both applications. `backend/tests/` holds backend tests and `backend/prisma/schema.prisma` is the application-model contract.

## Local setup and checks

Use Node.js 20 and a separately provisioned compatible MySQL database. From the repository root, install dependencies with `npm ci`. Copy `backend/.env.example` to a local `backend/.env` and `frontend/.env.example` to a local `frontend/.env.local`; set values appropriate to the environment. Never commit or distribute real `.env` files or credentials. The frontend example uses a local API URL, and the backend requires a non-empty `JWT_SECRET`.

These commands generate a client or check source; they do **not** provision or upgrade a physical database:

```sh
cd backend
npx prisma generate
npx prisma validate
cd ..
npm run dev
```

Run checks from the indicated working directories:

```sh
npm test
cd backend
npx tsc --noEmit
npm run build
cd ../frontend
npx tsc --noEmit
npm run build
```

The repository has no root `typecheck` script. See [TESTING.md](TESTING.md) for CI and test limitations.

> **Database governance:** `schema.prisma` is the current application contract. Physical provisioning and change records are approved operational material outside this source repository. Do **not** use Prisma migration, push, pull, reset, or drop/recreate commands as a production procedure. See [DATABASE.md](DATABASE.md) before database work.

## Maintainer and handoff documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — current application boundaries and financial flows.
- [DATABASE.md](DATABASE.md) — authoritative database governance.
- [TESTING.md](TESTING.md) — executable checks and known coverage limits.
- [SECURITY.md](SECURITY.md) — current controls, secret handling, and planned hardening.
- [DEPLOYMENT.md](DEPLOYMENT.md) — **planned / not implemented yet** production infrastructure.
- [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — **planned / not implemented yet** backup and recovery policy.
- [SOURCE_HANDOFF.md](SOURCE_HANDOFF.md) — client source-package rules and packaging command.
