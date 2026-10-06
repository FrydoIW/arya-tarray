# Prisma database contract

`schema.prisma` is the current Arya Tarray application-model contract. It does not prove the physical state of a target database and it is not an automatic deployment mechanism. Physical provisioning and structural change records are reviewed, approved, and access-controlled outside this source repository; inspect each target independently.

`arya_bank_transaction.member_identity_id` resolves canonical ownership through `arya_member_identity`; no direct transaction-to-Member relation exists. Approval configuration uses one `arya_approval_config` header and `arya_approval_config_approver` membership records with ANY-ONE semantics.

After an approved physical change, regenerate the Prisma client and validate the model:

```sh
npm run db:generate
npm run db:validate
```

Do not run Prisma migration, push, pull, reset, or drop/recreate commands as the current database workflow.

## Production-safe bootstrap and seed

- `seed.ts` never changes the password, name, or active/inactive status of an existing bootstrap admin.
- If the bootstrap admin does not exist, set `BOOTSTRAP_ADMIN_PASSWORD` (minimum 12 characters) before running `npm run db:seed -w backend`.
- `bootstrap-admin.sql` contains no embedded password or automatic USE statement. Select the approved DEV target explicitly; future PROD use requires separate approval. Its writes are gated to the current DEV/future PROD names. Existing user credentials/status are never overwritten; creating a missing admin requires explicitly supplying a fresh bcrypt hash in the SQL session.
- `JWT_SECRET` has no application fallback. Backend startup fails when it is absent.
