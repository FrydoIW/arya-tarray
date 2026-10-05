# Database governance

`backend/prisma/schema.prisma` is the current Arya Tarray application-model contract. It describes the model the application expects; it does not prove the physical state of any database and it never applies changes automatically.

Physical database provisioning and structural changes are controlled through approved, access-restricted operational change records outside this source repository. Before a physical change, the authorized operator must inspect the exact target schema, constraints and data; prepare recovery; obtain approval; record the target, operator, time and outcome; then verify the physical invariants and relevant application behavior.

After an approved physical change, run the following source checks from `backend/`:

```sh
npx prisma generate
npx prisma validate
```

`prisma validate` validates the model only; `prisma generate` updates the client only. Neither command verifies or changes a physical database.

## Local integration-test schema only

`backend/tests/integration/current-schema.mysql.sql` is a reviewed schema-only snapshot for bootstrapping a **new empty local** `arya_tarray_test` database. It is not a production or staging bootstrap and does not certify any other environment. `npm run test:db:bootstrap` requires `TEST_DATABASE_URL`, applies only to the guarded local test database, refuses a nonempty schema, and never drops or resets a database. See [TESTING.md](TESTING.md).

## Prohibited commands

Do not run `prisma migrate dev`, `prisma migrate deploy`, `prisma db push`, `prisma db pull`, `prisma migrate reset`, or any drop/recreate workflow against an Arya Tarray target. Do not infer a target's condition from source history.

For Member identity backfill, follow the separate [runbook](docs/member-backfill-runbook.md). It requires an explicit dry run or human-approved apply and is never part of automatic database deployment.
