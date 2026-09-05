# Arya Tarray Development Rules

## Product and architecture

Arya Tarray is a calm, compact internal operations dashboard for Yayasan Arya Tarray Nusantara. Preserve the current Route → Controller → Service → Repository → Prisma backend flow and thin Next.js routes → feature components/hooks/API → `lib/api.ts` frontend flow.

Current navigation:

1. Monitoring — Dashboard
2. Reconciliation — Statement Upload, Edit Income, Transaction Inquiry
3. Approval Line — Sign Approval
4. Donatur — Registrasi Donatur, Data Donatur
5. Configuration — Role, User, Event Code, Approval, Bank Account

## Reconciliation invariants

- Preserve the `RAW → CHECK → FINALIZED` lifecycle and audit history.
- The BCA parser groups transactions from dated rows and preserves source evidence.
- Only eligible incoming credits participate in suffix classification. Debit, `BUNGA`, and `CR KOREKSI BUNGA` rules must remain intact.
- Suggested Event and actual Final Event are distinct. Manual correction and approval remain auditable.
- Event codes are three-character strings so leading zeroes are preserved.
- Sign Approval uses ANY-ONE semantics.

## Donatur invariants

- Canonical ownership is `BankTransaction → MemberIdentity → Member`; never add a direct transaction-to-Member relation.
- Identity states are `UNVERIFIED`, `VERIFIED`, and `IGNORED`. Preserve raw evidence and never fuzzy auto-link.
- Move changes only current identity ownership. Detach removes canonical ownership while retaining identity and transaction links.
- Official Member donation means `FINALIZED`, `originalAmount > 0`, actual `eventCodeId`, and a VERIFIED identity resolving to the Member. Never substitute `baseAmount` or store derived donation totals.
- Historical backfill never creates canonical Members and requires explicit `--dry-run` or human-approved `--apply`.

## Database governance

- MySQL 8.4 / utf8mb4; production database name `arya_tarray`.
- `backend/prisma/schema.prisma` is the current application contract.
- Deliver current structural changes only as reviewed manual patches under `backend/prisma/patches/`.
- Never execute patches automatically from application startup or tooling.
- The active Prisma migration directory is historical compatibility state, not a current rebuild/bootstrap mechanism. Do not rewrite, delete, or move it without reconciling every target database’s `_prisma_migrations` history.
- Do not run `prisma migrate dev`, `prisma migrate deploy`, `prisma db push`, `prisma db pull`, reset, or drop/recreate workflows.
- After an approved physical patch is applied by a human, run `npx prisma generate` and `npx prisma validate`.
- Never commit credentials.

## Implementation safety

- Validate inputs and keep business rules outside route handlers.
- Use transactions for statement persistence, identity ownership changes, and approval/history operations.
- Preserve Asia/Jakarta business-time behavior, admin anti-lockout, permission-based navigation, and automated tests.
- Prefer end-to-end feature slices, bounded database queries, and batch aggregation. Do not introduce N+1 queries or calculate financial totals from paginated frontend rows.
- Keep the established warm ivory, deep maroon, and restrained gold UI; do not redesign stable screens during maintenance work.
