# Database governance

`backend/prisma/schema.prisma` is the current Arya Tarray application-model contract. It describes the model the application expects; it does not prove the physical state of any database and it never applies changes automatically.

Physical database provisioning and structural changes are controlled through approved, access-restricted operational change records outside this source repository. Before a physical change, the authorized operator must inspect the exact target schema, constraints and data; prepare recovery; obtain approval; record the target, operator, time and outcome; then verify the physical invariants and relevant application behavior.

After an approved physical change, run the following source checks from `backend/`:

```sh
npx prisma generate
npx prisma validate
```

`prisma validate` validates the model only; `prisma generate` updates the client only. Neither command verifies or changes a physical database.

## Local DEV schema and read-only preflight

Local Accounting application and integration testing share exactly `arya_tarray_dev`.
Local `arya_tarray_prod` is separately restored for the current pre-Accounting `main`
baseline and presentation testing: 32 application tables plus preserved migration
metadata, no Accounting tables or menu. It is not an integration-test target. Its
approved external record is `20261007-local-prod-setup.md`; the Accounting PROD
patch remains reserved for a separately approved later release. The two obsolete local databases were
retired under explicit approval on 2026-10-07 after DEV/runtime preflight and private
recovery dumps. They are not runtime/test targets and must not be recreated.

`backend/tests/integration/current-schema.mysql.sql` is a reviewed 35-table schema
reference, not an automatic provisioning workflow. A new DEV schema requires an
explicit operational approval. `npm run test:db:verify` (and the compatibility alias
`test:db:bootstrap`) now perform SELECT-only preflight: actual database, required
columns/indexes/FKs/enforced CHECKs, approved COA, and Accounting PAGE. They never
import SQL, create, seed, truncate, or reset a database. See [TESTING.md](TESTING.md)
and [local environment separation](docs/local-environments.md).

## Prohibited commands

Do not run `prisma migrate dev`, `prisma migrate deploy`, `prisma db push`, `prisma db pull`, `prisma migrate reset`, or any drop/recreate workflow against an Arya Tarray target. Do not infer a target's condition from source history.

For Member identity backfill, follow the separate [runbook](docs/member-backfill-runbook.md). It requires an explicit dry run or human-approved apply and is never part of automatic database deployment.
