# Member identity backfill runbook

The backfill creates or reuses `MemberIdentity` rows and populates only `BankTransaction.member_identity_id`. It uses the same canonical eligibility, sender evidence, normalization, identity-key, reuse, linking, and observation-bound logic as live Statement Execute.

It never creates canonical Member profiles, guesses ownership, fuzzy-matches names, marks new identities VERIFIED, or changes financial/reconciliation fields. New identities remain `UNVERIFIED`; existing VERIFIED identities retain their Member association and verification state.

## Required sequence

Run commands from `backend/`.

1. Create and verify a restorable database backup. Record backup location and timestamp outside this repository.
2. Run the read-only integrity verifier:

   ```bash
   npm run member:verify
   ```

3. Run read-only analysis:

   ```bash
   npm run member:backfill -- --dry-run
   ```

   Optional bounded rehearsal:

   ```bash
   npm run member:backfill -- --dry-run --batch-size=500 --limit=5000
   ```

4. Review scanned, eligible, already-linked, skipped, identity reuse/create, projected links, verification-state, conflict/error, batch, and duration counts. Investigate any conflict or failed integrity check.
5. Only after explicit human approval and backup confirmation, run real bounded processing:

   ```bash
   npm run member:backfill -- --apply --batch-size=500
   ```

   Each batch commits independently. If a batch fails, stop, retain its cursor/context message, resolve the cause, and rerun. Prior committed batches remain valid; unique `identity_key`, conditional transaction linking, and the unlinked-row selector make reruns idempotent.
6. Run verification again:

   ```bash
   npm run member:verify
   ```

7. Review resulting `UNVERIFIED` candidates in **Donatur → Registrasi Donatur**. Human Register New / Link Existing decisions remain mandatory.

## Safety notes

- The command refuses to run without explicit `--dry-run` or `--apply`.
- `--dry-run` has no writer/transaction dependency and performs only reads.
- The backfill never updates amount, `originalAmount`, `baseAmount`, Final/Suggested Event, transaction/statement status, dates, sender evidence, approval, or history.
- Do not run Prisma migration/push/pull/reset commands as part of this runbook.
