# Client source handoff policy

A source ZIP is not a working-directory ZIP, dependency cache, build output, secret store, or database backup. Generate it from the repository's explicit source allowlist with `node scripts/package-source.mjs` at the repository root. The script stages only approved repository files in a new operating-system temporary directory, checks required paths, rejects forbidden staged paths and known private-key patterns, prints its complete manifest, and verifies the ZIP contents when an archiver is available. Review the manifest and archive before transfer; automated checks cannot certify that all screenshots, fixtures or prose are free of personal data.

## Include

- `frontend/src/`, `frontend/public/`, required frontend configuration, and `frontend/.env.example`.
- `backend/src/`, `backend/tests/`, `backend/scripts/`, backend configuration, and `backend/.env.example`.
- Root and workspace `package.json` files, root `package-lock.json`, CI configuration, current documentation, and specialist runbooks.
- `backend/prisma/schema.prisma`, current seed source, and the password-free bootstrap helper.

## Exclude

- Dependencies, build output, coverage/cache files, logs, IDE settings, uploads, local runtime files, and local backups.
- Real `.env` variants; only `.env.example` is allowed.
- Database dumps/backups, uploaded bank statements, temporary exports, generated reports, browser captures, and local agent material.
- `docs/design/` from the default client package.

## Review before release

1. Confirm the intended commit/worktree and that [DATABASE.md](DATABASE.md) is current.
2. Run the packager from the repository root; retain its manifest and output location.
3. Confirm application source, assets, tests, lockfile, Prisma contract, seed source, bootstrap helper, and environment examples are present.
4. Confirm secrets, ignored local files, snapshots, dumps, logs, and generated output are absent from staging and the ZIP listing.
5. Manually review included test fixtures, runtime imagery, prose, and files for personal data, licensing, and credential-like material.
6. Record the source commit, manifest, archive hash, recipient, and reviewer approval. Transfer over an approved channel; never include live `.env` or database data to make the source package runnable.
