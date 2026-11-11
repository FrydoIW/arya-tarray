# Local DEV / PROD separation

Only `backend/.env` is active. Ignored `backend/.env.dev.local.txt` is the usable
DEV reference; `.env.prod.local.txt` is the usable local pre-Accounting PROD reference.
Both remain private and ignored. They are never automatically loaded. There is no Git-branch-based
environment selection. Manually copy the chosen reference to `.env` and restart
the backend, clearing stale inherited environment variables first. Use the Accounting
feature branch with DEV and the pre-Accounting `main` baseline with PROD. Preserve
uncommitted work before any manual branch switch; this setup never switches branches.
Never run current Accounting code against the pre-Accounting PROD schema.

## Current approved local state

- DEV: `arya_tarray_dev`, application database. Current Stage 2.1 instructions prohibit writing integration tests here; the previous shared-DEV fixture authorization is historical.
- DEV-only Accounting cutover: `2026-10-01`, explicitly reapproved and activated under `AT-ST21-20261105-01` scope C, based on transaction date with no backfill. FY2026 is calendar-year OPEN; October/November/December periods are OPEN.
- Current DEV: 61 tables, including 29 Accounting models after approved Stage 2.1. Isolated `arya_tarray_test` also has 61 tables and only minimal synthetic configuration masters. This separately approved provisioning did not restore retired data or run from test startup.
- Local PROD: `arya_tarray_prod`, restored from only the former original database's
  private recovery section; 32 application tables plus preserved migration metadata.
  Existing presentation users/data were preserved, not reseeded. No Accounting
  tables/menu/COA/journals/cutover or DEV/test fixtures were copied.
- DEV and PROD exist locally; the two obsolete databases were retired under explicit
  approval on 2026-10-07. Do not recreate them for application or integration tests.

The new DEV schema was explicitly authorized on 2026-10-07. Its 35 application
tables use the reviewed current physical schema (including Accounting FKs, indexes
and enforced CHECKs), with 1110 Bank and 4110 Contribution Revenue. The existing
repository seed creates fresh roles, an admin with a new private password, and
three standard Event masters. Additional menu definitions come from current
frontend navigation; all active PAGE grants are assigned only to the new DEV admin.
No legacy user credentials, donor/identity/bank/statement/transaction data or test
journals were copied. Configure synthetic bank/approval settings in the UI as needed.
This DEV provisioning is not an automatic workflow for another environment.

The 35-table provisioning paragraph above is historical. Later Stage 1 reached
56 tables and approved Stage 2.1 reached 61; see `accounting-stage2.1-complete.md`
for current schema, backup and test evidence. Existing Statement Upload approval
configuration remains unchanged. Accounting approvers are configured with
`/api/accounting/approval-settings` under CONFIG_APPROVAL after the intended
users receive the separate Accounting role/menu permissions. No new grants or
approver assignments were applied automatically.

The local server is MySQL 8.0.42 (supports the enforced constraints); the deployment
target remains MySQL 8.4. DEV runtime principal `arya_tarray_dev_local` has only
SELECT/INSERT/UPDATE/DELETE on the exact DEV database, no global/other database/DDL
privileges. PROD uses separate `arya_tarray_prod_local` credentials with the same
DML-only restriction on exact PROD. Each principal is denied access to the other
database. Generated secrets remain only in ignored local env files. Never print
URLs, passwords, tokens or reference contents in diagnostics or Git.

## Integration safety

Current Stage 2.1 tests require a separately approved/provisioned loopback MySQL
`arya_tarray_test` database and a TEST-only DML principal. No test command creates,
restores, migrates or seeds a schema. Historical database retirement does not grant
permission to recreate a database; new TEST provisioning needs its own approved
operational record.

Supply `ARYA_ENV=TEST`, `TEST_DATABASE_URL`, `ALLOW_TEST_INTEGRATION_WRITES=true`
and an explicit fixture-compatible `ACCOUNTING_CUTOVER_DATE` to the test process.
Do not change active `.env` for tests. The loader imports only non-selection local
settings such as authentication configuration; it never imports the DEV database
URL, cutover or old DEV write acknowledgment. An inherited `DATABASE_URL`, if set,
must already match TEST. The selected URL must name exactly `arya_tarray_test`,
with no query/fragment overrides; `SELECT DATABASE()` is checked again before
schema inspection, fixture setup and cleanup. DEV and PROD are rejected.

`npm run test:db:verify` and old alias `test:db:bootstrap` are read-only preflight,
not provisioning/reset commands. Normal test startup never imports the SQL snapshot.
Fixture setup/cleanup recheck safety and operate only on recorded UUID/ownership
scopes, then verify owned rows are absent. The TEST schema must match the current
Prisma contract and have the required test masters and open period for the
November 2026 Accounting fixtures. The TEST cutover must be after 2026-09-30 and
no later than 2026-11-01; this is fixture configuration, not DEV/PROD policy.
Do not change configuration during a test run. The approved TEST-only connection
is now configured privately outside Git. To run without printing credentials or
changing active DEV `.env`, use:

```powershell
node D:/arya-tarray-change-records/AT-ST21-20261105-01-execution/run-integration.mjs
```

37/37 integration tests passed. Verified cleanup leaves only 2 account masters,
1 menu, 1 fiscal year and 3 periods. No fixture users, operational data, drafts,
approval/history or journals remain. The temporary administrator connection file
used for provisioning was removed; repeat test execution uses TEST DML only.

## DataGrip

The obsolete local datasource and its attached reset console/history were removed
from the external DataGrip project. `Arya Tarray DEV` still targets DEV with its
restricted principal, unchanged by PROD setup. The existing `Arya Tarray PROD`
entry targets PROD with `arya_tarray_prod_local` and Password Safe storage. Its
installed JDBC driver has passed read-only `SELECT DATABASE()` using the private
PROD reference credentials; an actual IDE login still requires saving its password. Other
datasources/consoles are untouched. Private backups and retired one-time scripts
are kept outside the repository under `%LOCALAPPDATA%/AryaTarray/recovery/`.

After reopening DataGrip, if its DEV credential is not already saved, enter the
password from the ignored DEV reference into JetBrains Password Safe. Then run `SELECT DATABASE()` and confirm
`arya_tarray_dev`. For PROD, enter the password from `.env.prod.local.txt` into the
existing PROD entry's JetBrains Password Safe, test the connection, then run
`SELECT DATABASE()` and confirm `arya_tarray_prod`. No plaintext password is stored
in datasource XML. Do not use DEV/root credentials for PROD.

## Manual main/presentation check

The active `.env` remains DEV after setup. When uncommitted work has been safely
preserved and `main` is selected manually, copy the PROD reference to `.env`, clear
inherited DEV/test/cutover variables, restart the backend and frontend, and log in
using an existing restored presentation user's password. Do not run seed/reset or
integration commands. Restore the DEV reference and restart before returning to
Accounting development. No Accounting release/cutover is authorized by this setup.

An isolated Git-object export of `main` passed backend health, authorization and
15 read-only authenticated routes (Monitoring, Configuration, Reconciliation,
Approval, Donatur). The smoke used a short-lived locally signed token because no
existing user's password was available. Password login and browser rendering remain
manual checks; users/password hashes were preserved without reset.

## Operational recovery and future release

Current Stage 2.1 approval/execution records are in access-controlled
`D:/arya-tarray-change-records/`, with the actual decision recorded in
`AT-ST21-20261105-01-APPROVED.md` and completion in
`AT-ST21-20261105-01-COMPLETED.md`. The historical AppData record location below
is unavailable on this computer and was not treated as current approval evidence.

Keep the private recovery dumps, env/datasource backups and archived one-time
scripts access controlled. They are recovery evidence, not current setup tools.
The approved execution record is outside the repository at
`%LOCALAPPDATA%/AryaTarray/change-records/20261007-dev-separation.md`;
private envs/recovery material are restricted to the current Windows account,
Administrators and SYSTEM.
The separate legacy retirement record is `20261007-legacy-retirement.md` in the same
external change-record directory. Separate explicit approval authorized the local
pre-Accounting PROD restore in `20261007-local-prod-setup.md`. It used only the
former original database section of the verified retirement dump, under the new
name; neither retired name was recreated. DEV schema/data/env fingerprints stayed
unchanged. Restored data fingerprints match all 33 original tables; four DDL hashes
differ only because MySQL made redundant UTF-8 charset declarations explicit.
This does not authorize Accounting PROD deployment, cutover changes, schema
synchronization, Prisma migration/push/pull/reset, or Git commit/push/merge.
A later Accounting PROD release still needs separate approval, physical change
record, verified schema and approved cutover; never clone fixtures/journals from DEV.
