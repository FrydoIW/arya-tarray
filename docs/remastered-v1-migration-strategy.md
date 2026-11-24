# Remastered V1 migration strategy

## Status

The historical repository did not contain the SQL body for the sole database
migration recorded as `20260818_init`. The empty placeholder directory was not
replayable and caused Prisma `P3015` on a clean database.

This remediation uses two explicit artifacts:

- `backend/prisma/migrations/20261124000000_remastered_v1_reconstructed_baseline/migration.sql`
  is a reconstructed, complete baseline generated from the current Prisma
  schema. It is intended for a new empty database.
- `database/remastered-v1-consolidated-fixes.mysql.sql` is the controlled
  upgrade from repository HEAD `2e290ee` to the corrected schema. It is intended
  for an existing Remastered V1 database only after backup and preflight.

The baseline is deliberately named **reconstructed**. It is not represented as
the missing historical SQL and must not be marked as applied to an existing
database without an approved migration-baseline procedure.

## Fresh database replay

1. Point `DATABASE_URL` at a new, isolated empty MySQL database.
2. Run `prisma migrate deploy`.
3. Run `prisma validate` and compare the physical schema to `schema.prisma`.
4. Do not seed with production or donor data.

## Existing database upgrade

1. Confirm the target database and obtain an independently verified backup.
2. Run the read-only compatibility queries for composite Child/parent pairs.
3. Execute `database/remastered-v1-consolidated-fixes.mysql.sql` in the approved
   change window. Its preflight runs before any DDL and aborts on invalid pairs.
4. Record the reconstructed baseline with Prisma only through the approved
   baselining procedure; never rerun it over existing tables.
5. Validate all new tables, columns, indexes, foreign keys, and application
   smoke tests before release.

The controlled upgrade backfills ITEM_SALE fund evidence only for positive,
FINALIZED, non-excluded ITEM_SALE bank transactions. Confirmed purchases receive
their evidenced sale allocation; every other state remains fully unallocated.
Verified identities are attributed to their existing Member and all other funds
remain SUSPENSE. The backfill is idempotent and never changes bank, inventory, or
purchase records.

## MySQL compatibility

The generated DDL targets the project's Prisma MySQL provider and uses features
available in MySQL 8.0.42. MySQL 8.4 behavior has not been independently
verified. Production application remains blocked until backup, change approval,
and the target-specific dry run are complete.

## Final source-review revision

The final working-tree revision adds the following schema-safe changes on top
of the reconstructed baseline:

- `arya_bank_transaction.evidence_fingerprint` remains stored and indexed for
  evidence matching, but its unique constraint is removed. A BCA reference is
  not treated as a guaranteed unique bank transaction ID; legitimate transfers
  with the same reference must not be rejected by the database.
- `arya_item_sale_purchase.wallet_applied_amount` records authorized wallet
  funding applied to a pending purchase.
- `arya_item_sale_fund.other_allocated_amount` records customer liability moved
  from a source receipt to another settlement destination.
- `arya_item_sale_fund_allocation` is the append-only authorized allocation and
  reversal record linking a source fund, a destination purchase, its actor,
  reason, idempotency key, and reversal metadata.

The consolidated upgrade adds these columns/table with zero-value defaults for
existing rows and replaces the fingerprint unique index with a non-unique
index. Existing bank, purchase, inventory, fund, and ledger data is not
rewritten. The reconstructed baseline includes the same final schema.
