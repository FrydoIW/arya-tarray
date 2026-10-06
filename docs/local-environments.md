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

- DEV: `arya_tarray_dev`, application and fixture-scoped integration tests.
- DEV-only Accounting cutover: `2026-10-01`, based on transaction date; no backfill.
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

The local server is MySQL 8.0.42 (supports the enforced constraints); the deployment
target remains MySQL 8.4. DEV runtime principal `arya_tarray_dev_local` has only
SELECT/INSERT/UPDATE/DELETE on the exact DEV database, no global/other database/DDL
privileges. PROD uses separate `arya_tarray_prod_local` credentials with the same
DML-only restriction on exact PROD. Each principal is denied access to the other
database. Generated secrets remain only in ignored local env files. Never print
URLs, passwords, tokens or reference contents in diagnostics or Git.

## Integration safety

Set `ARYA_ENV=DEV` and `ALLOW_DEV_INTEGRATION_WRITES=true` in active `.env`.
Both app/test URLs must match and select exactly loopback MySQL `arya_tarray_dev`.
No URL query/fragment connection overrides are supported by the integration guard.
The explicit loader refuses inherited conflicting mode, URLs, acknowledgment or
cutover before connecting. `SELECT DATABASE()` must also match before fixtures.

`npm run test:db:verify` and old alias `test:db:bootstrap` are read-only preflight,
not provisioning/reset commands. Normal test startup never imports the SQL snapshot.
Fixture setup/cleanup recheck safety and operate only on recorded UUID/ownership
scopes. Run integration tests only on local DEV, not on legacy/test/PROD or
any arbitrary database. Do not change configuration during a test run.

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
