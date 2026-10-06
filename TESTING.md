# Testing and validation

This document describes checks executable from the current source. A passing test or build is not proof that a target MySQL database matches `backend/prisma/schema.prisma` or has been provisioned correctly.

## Current commands

Install dependencies from the repository root with `npm ci` when setting up a clean checkout. The repository has no root `typecheck` script; run the actual workspace commands separately:

| Check | Working directory | Command |
| --- | --- | --- |
| Backend tests (also root `npm test`) | `backend/` | `npm test` |
| Real-MySQL integration tests | repository root | `npm run test:integration` |
| Verify shared local DEV (read-only preflight) | repository root | `npm run test:db:verify` |
| Integration-test TypeScript | `backend/` | `npm run test:integration:typecheck` |
| Playwright browser smoke | repository root | `npm run test:browser` |
| Full suite (requires test MySQL and browser) | repository root | `npm run test:full` |
| Backend TypeScript | `backend/` | `npx tsc --noEmit` |
| Frontend TypeScript | `frontend/` | `npx tsc --noEmit` |
| Backend build | `backend/` | `npm run build` |
| Frontend production build | `frontend/` | `npm run build` |
| Prisma Client generation | `backend/` | `npx prisma generate` |
| Prisma model validation | `backend/` | `npx prisma validate` |

Run Prisma generation before backend checks in a clean checkout. Generation and validation do not update physical schema. Do not use Prisma migration, push, pull, or reset commands for validation; see [DATABASE.md](DATABASE.md).

## Existing coverage

`backend/tests/run-tests.ts` imports the default backend unit/contract suites. Tests exercise reconciliation classification and BCA parsing, approval and correction rules, Member/identity and donation rules, TIME_BASED allocation/coverage, CAMPAIGN financial evidence, carry transfer/idempotency/reversal, configuration, and monitoring read-model behavior. Some tests use fake transaction clients or source/contract assertions. Parser regression inputs are constructed from synthetic values in test source. The default `npm test` does not connect to MySQL.

## Shared DEV MySQL integration tests

Accounting suites verify recognition, approval concurrency/rollback, immutable reclassification
snapshots, cutover (including corrections), review-required cases, all four Carry paths, Member
no-GL behavior, report/export consistency and backend permission. Approved local
DEV cutover is `ACCOUNTING_CUTOVER_DATE=2026-10-01`; scenarios include September
pre-cutover and November post-cutover evidence. This is not PROD cutover approval.
Provision current schema/accounts/menu only through an approved operational change;
the runner never applies DDL. See [Accounting Phase 1](docs/accounting-phase1.md).

`npm run test:db:verify` verifies an already provisioned `arya_tarray_dev` without
writes. The old `test:db:bootstrap` name is a compatibility alias for the same
read-only verification, NOT a schema importer. Legacy `arya_tarray` and
`arya_tarray_test`, future PROD, and arbitrary names are rejected.

Private `backend/.env` must set `ARYA_ENV=DEV`,
`ALLOW_DEV_INTEGRATION_WRITES=true`, and matching `DATABASE_URL` / `TEST_DATABASE_URL`
on loopback MySQL with the exact database name `arya_tarray_dev`. Use the DEV-only
DML principal, never a privileged legacy/root connection. Run `npm run test:db:verify`
then `npm run test:integration` from the root. No MySQL CLI is required by preflight.
Check test code without MySQL with `npm run test:integration:typecheck -w backend`.

The runner explicitly loads backend/.env first, refuses stale/conflicting inherited
selection variables (including cutover), and checks its target before importing
application/fixture modules. It rejects non-DEV mode, missing acknowledgment,
non-MySQL/remote hosts, URL query/fragment overrides, and differing app/test connections.
It verifies actual `SELECT DATABASE()` and current schema before registering tests.
Fixture setup and cleanup independently check URL/mode/acknowledgment and actual database.
UUID/ownership-scoped cleanup removes only each fixture's rows; manual DEV rows are
not globally erased. Do not switch environment or edit backend/.env during a run.
Guard tests include actual connection mismatch and all forbidden targets without
connecting to them. Clear stale shell variables before rerunning; never print URLs.

## Browser smoke tests

Run `npx playwright install chromium` once on a new machine, then `npm run test:browser` from the repository root. If Google Chrome is already installed, set `PLAYWRIGHT_USE_SYSTEM_CHROME=1` instead of downloading bundled Chromium. The smoke suite renders the login entry, performs a fake login, and loads a read-only Campaign workspace with intercepted test responses; no real backend credentials or database are needed.

`.github/workflows/ci.yml` runs `npm ci`, Prisma generation/validation, both TypeScript checks, root backend tests, and both production builds on pushes and pull requests to its configured branches. The MySQL and browser suites are opt-in because their external prerequisites are not provided by this CI job.

## Current limitations

Accounting browser coverage uses a synthetic read-only workspace to check preview/review labels,
report tabs and export downloads. The standalone frontend lint command currently opens an ESLint
configuration prompt; no linter configuration has been added as part of Accounting.

Run the MySQL suite only against provisioned local DEV before reporting its financial assertions as passing there. The browser suite uses mocked API responses and does not exercise a real authenticated backend workflow. Typecheck/build alone do not establish business-data correctness.
