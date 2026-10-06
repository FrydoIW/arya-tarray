# Testing and validation

This document describes checks executable from the current source. A passing test or build is not proof that a target MySQL database matches `backend/prisma/schema.prisma` or has been provisioned correctly.

## Current commands

Install dependencies from the repository root with `npm ci` when setting up a clean checkout. The repository has no root `typecheck` script; run the actual workspace commands separately:

| Check | Working directory | Command |
| --- | --- | --- |
| Backend tests (also root `npm test`) | `backend/` | `npm test` |
| Real-MySQL integration tests | repository root | `npm run test:integration` |
| Bootstrap a new empty local test database | repository root | `npm run test:db:bootstrap` |
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

## Dedicated MySQL integration tests

Accounting suites verify recognition, approval concurrency/rollback, immutable reclassification
snapshots, cutover (including corrections), review-required cases, all four Carry paths, Member
no-GL behavior, report/export consistency and backend permission. Set
`ACCOUNTING_CUTOVER_DATE=2026-11-01` for these synthetic scenarios. Provision Accounting
tables/accounts/menu in an existing test schema through the approved local patch process;
the runner never applies DDL. See [Accounting Phase 1](docs/accounting-phase1.md).

For a **new empty** local MySQL database named exactly `arya_tarray_test`, use the reviewed schema-only snapshot and `npm run test:db:bootstrap`. The bootstrap reads `TEST_DATABASE_URL`, refuses non-loopback/non-test URLs and any existing nonempty target, and imports DDL only. It does not copy application rows, alter an existing schema, or reset a database. The integration runner itself never creates or alters schema. Never point either command at `arya_tarray`, a shared database, or a copied production database.

Set `TEST_DATABASE_URL` to a local test-only MySQL URL ending in `/arya_tarray_test`; keep it in the local process environment, never a committed file or console output. A dedicated MySQL account limited to the test schema is preferable. The bootstrap requires the MySQL command-line client (`mysql` on PATH, or set `MYSQL_CLIENT_BIN` to its executable path). Run `npm run test:db:bootstrap` once, then `npm run test:integration` from the repository root. To check test code without MySQL, run `npm run test:integration:typecheck -w backend`.

The runner checks its target **before importing production modules or creating Prisma connections**. It refuses missing/invalid URLs, non-loopback hosts, any database name other than `arya_tarray_test`, and a configured application `DATABASE_URL` pointing to the same database. It redirects the production Prisma client to this test URL only inside the test process. Each scenario creates UUID-scoped fixture rows and deletes only those recorded rows in dependency order in `finally`; there is no global `TRUNCATE`, reset, or cleanup of unrelated data.

## Browser smoke tests

Run `npx playwright install chromium` once on a new machine, then `npm run test:browser` from the repository root. If Google Chrome is already installed, set `PLAYWRIGHT_USE_SYSTEM_CHROME=1` instead of downloading bundled Chromium. The smoke suite renders the login entry, performs a fake login, and loads a read-only Campaign workspace with intercepted test responses; no real backend credentials or database are needed.

`.github/workflows/ci.yml` runs `npm ci`, Prisma generation/validation, both TypeScript checks, root backend tests, and both production builds on pushes and pull requests to its configured branches. The MySQL and browser suites are opt-in because their external prerequisites are not provided by this CI job.

## Current limitations

Accounting browser coverage uses a synthetic read-only workspace to check preview/review labels,
report tabs and export downloads. The standalone frontend lint command currently opens an ESLint
configuration prompt; no linter configuration has been added as part of Accounting.

Run the MySQL suite against a provisioned test database in each environment before reporting its financial assertions as passing there. The browser suite uses mocked API responses and does not exercise a real authenticated backend workflow. Typecheck/build alone do not establish business-data correctness.
