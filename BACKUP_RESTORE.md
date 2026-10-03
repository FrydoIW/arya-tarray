# Backup and restore policy — planned / not implemented yet

This is an operational policy plan, not evidence that backups or restore automation currently exist. Do not apply a physical SQL patch or perform a risky data operation without a separately approved, **verified restorable backup** for that target environment.

## Planned backup flow

MySQL → scheduled consistent backup → compression → encryption → short-lived protected local staging → offsite storage → retention and integrity checks → periodic restore rehearsal.

Choose the MySQL-consistent snapshot method, schedule, retention, encryption/key custody, access roles, offsite provider, recovery-point objective and recovery-time objective with the operator/client. Example daily/weekly/monthly retention is only a planning concept; **no numeric retention or recovery target is approved by this repository**. Confirm that backup staging and persistent MySQL storage fit the target host capacity.

Backup files, temporary exports, raw statement uploads, encryption keys and restore credentials must **never** be committed to Git or included in a client source ZIP. Use access control, encrypted transfer and documented deletion of temporary copies. Keep keys separate from their encrypted backups and test key availability during rehearsals.

## Planned restore rehearsal and incident procedure

Restore into an isolated environment first. Verify backup integrity, schema/constraint shape, environment-specific patch/application record, key financial and identity evidence, and application smoke checks. Record duration and discrepancies. A production incident procedure should identify the decision owner, communication path, clean target, recovery order, data-loss window and post-restore reconciliation before service resumes.

For a reviewed schema change, record backup location and verification, patch section, recovery decision and target-specific outcome as described in [DATABASE.md](DATABASE.md). No backup script, schedule, offsite integration or production restore workflow is implemented in this Phase 0 change.
