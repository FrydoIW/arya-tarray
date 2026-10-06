# Accounting Phase 1

The Accounting workspace (`/accounting`) provides Pending Preview, Reconciliation,
Journals, General Ledger, Trial Balance, Monthly Summary, and Excel/PDF exports.
Backend authorization uses the existing active PAGE grant `ACCOUNTING_REPORT` for
every endpoint. Grant this menu through Configuration → Role; there is no automatic
grant to existing roles and no journal edit/delete capability.

## Deployment and database change record

Review `.local/sql-patches/accounting-phase1-v1.mysql.sql` under an approved,
access-controlled operational change record outside Git. The patch remains ignored.
It creates three tables, the two posting accounts, and one PAGE menu with no backfill
or opening balance. DDL is not transactional. Follow its preconditions and stop on a
partial application; never blindly rerun against an existing Accounting table set.

Historical foundation gate: under explicit user authorization, Codex applied this patch only to the dedicated
local `arya_tarray_test` database on 2026-10-07. Verification found three Accounting
tables, 1110 Bank / 4110 Contribution Revenue, the PAGE menu, enforced constraints,
zero initial journals, and no unbalanced journals. The local test server is MySQL
8.0.42. Production remains MySQL 8.4; the patch was NOT executed against `arya_tarray`,
dev, UAT, production, or any non-test database at that foundation gate. That old test
database was subsequently retired; it is not a current setup target. No Prisma
mutation command was used.

For deployment, a human must review/apply the patch to the approved target during
its operational change window before enabling this feature. Run the verification
SELECTs in the patch: table set, account seeds, PAGE permission, CHECK/FK/UNIQUE
constraints, and the unbalanced-journal query (must return no rows). Then set
`ACCOUNTING_CUTOVER_DATE` to the approved first day of a month (`YYYY-MM-01`).
The example `2026-11-01` is test configuration, not production approval. There is no
fallback date or ordinary-user configuration screen. Once posting starts, treat
changing the cutover as an operational policy change; do not move it casually.

After provisioning, safe commands are `npm run db:generate -w backend` and
`npm run db:validate -w backend`, plus builds/typechecks and tests. Do not run Prisma
migrate, push, pull, reset, or application startup provisioning. Current local DEV
and integration connections share exactly loopback `arya_tarray_dev`, using a
DEV-only DML principal and explicit integration-write acknowledgment. Local DEV
cutover is approved as `2026-10-01`, not a future PROD cutover. The earlier test-only
patch record above remains historical; both obsolete local databases were later
retired under separate explicit approval after DEV validation and private recovery.
See [local environments](local-environments.md). Never print or commit credentials.

## Posting and corrections

Eligible FINALIZED BANK donations dated on/after cutover recognize originalAmount
as Dr 1110 / Cr 4110 for STANDARD, CAMPAIGN and TIME_BASED. Sign Approval owns one
Serializable transaction containing approval CAS, source finalization, operational
synchronization, Accounting posting and history. A failure rolls all of these back.
Transient serialization/deadlock aborts retry the entire transaction, at most three
retries. Source keys and journal numbers have authoritative database uniqueness.
Journal number uses accounting date plus UUID; it does not provide idempotency.

Corrections never backfill missing recognition. Approved Event/Campaign changes
append revenue-to-revenue reclassification linked to original recognition and the
correction item. The old dimension comes from prior posted accounting evidence,
including earlier reclassifications; the new dimension comes from approved source.
Remark changes, all Carry paths/reversals, coverage consumption, and Member ownership
changes create no GL. Member/donor snapshots remain those of original posting.

Exclusion leaves original accounting evidence intact and requires review when a
recognition journal exists. Finalized manual incoming/outgoing requires review,
with no automatic GL. Review states are derived, not a mutable journal workflow.
Pre-cutover rows remain operational only, even when approval happens after cutover.
Accounting date is the source business DATE; postedAt is the actual posting instant.

## Report meaning and limits

Official totals come only from journal lines, using exact database decimal SUM and
BigInt arithmetic. Reports represent Phase 1 activity from cutover, not complete
financial statements or bank balances including historical opening balances.
Trial Balance includes all lines of matching journals to retain balanced entries;
dimension-filtered revenue/GL shows the corresponding line dimensions. GL balances
are period movements, not reconstructed lifetime balances. Monthly grouping uses
accountingDate, never postedAt. Historical labels use snapshots rather than mutable
configuration/member names. Menu view permission also protects exports.

Journals, GL, reconciliation and pending source rows have server pagination. Monthly
groups and exports are bounded to 10,000 rows; narrow filters when exceeded. Proposed
manual additions are displayed separately as a bounded first-100 preview list and
never counted as posted journal rows. Filter lists are bounded; Member search returns
the first 50 matches. Preview allocates no journal number/source key and writes nothing.
Excel preserves decimal amounts as text so export cannot introduce floating-point
rounding. PDF reuses the existing renderer, with Accounting labels and exact values.

The schema-only integration snapshot supports new empty test databases only, and is
not a production patch. Existing nonempty test databases require the approved patch.
Tests remove only their recorded UUID-scoped fixtures; no global reset is required.

## Implementation validation — 2026-10-07

Resumed branch `20261006_EnhancementAccounting` from
`d7f536d1390cb41b5674faba7fd72dcf69e6925e`, preserving the existing foundation changes.
The previous filesystem interruption is no longer reproduced. Both the Accounting
foundation test and generated Prisma declarations are readable. A previously broken
generated client entry point required regeneration; application/domain work was retained.

- `npm test`: 397 passing (378 baseline + 19 Accounting domain/contract tests).
- Integration runner (`node --import tsx --test tests/integration/run-tests.ts`,
  safe process-local test connection, cutover `2026-11-01`): 24 passing
  (9 existing + 2 Accounting foundation + 13 Accounting integration).
- `npm run test:browser` with `PLAYWRIGHT_USE_SYSTEM_CHROME=1`: 3 passing.
- `npm run db:validate -w backend` and `npm run db:generate -w backend`: successful.
- `npm run test:integration:typecheck -w backend`, `npm run build -w backend`,
  `npx tsc -p frontend/tsconfig.json --noEmit`, and frontend production build: successful.
- Standalone `npm run lint -w frontend`: not configured; it opens the existing
  ESLint setup prompt. No unrelated lint configuration was introduced.
- Source packaging/privacy gates: verified allowlisted source archive, including
  Accounting and browser tests. The export source is named `accounting.report.ts`
  so the existing generated-export filename exclusion remains unchanged.

Regression coverage includes statement parsing/classification, reconciliation,
Edit Income, approval/rejection/ANY-ONE concurrency and rollback, TIME_BASED,
Campaign, Carry transfer/idempotency/reversal/dependency guards, Member ownership,
configuration anti-lockout, monitoring and authorization. Accounting tests check
all three recognition types, exact originalAmount, replay, immutable linked
Event/Campaign corrections, remark no-GL, pre-cutover corrections, pending read-only
preview, manual/exclusion review, report/Excel/PDF consistency and backend access.
The four Carry paths retain original journals; consumed TIME_BASED coverage still
blocks reversal according to existing operational rules. Accounting does not relax
that guard. The browser suite is API-mocked; MySQL service and auth tests are real.

Remaining deployment prerequisites: separately approved human SQL application to
non-test environments, approved cutover configuration, and role menu grants.
MySQL 8.4 deployment validation remains required because the available test server
is 8.0.42. Report/export bounds and period-movement scope described above are
intentional Phase 1 limits, not complete financial statements.
