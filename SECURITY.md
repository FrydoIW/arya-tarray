# Security and sensitive-data handling

Arya Tarray processes donor identity and financial statement data. This document records current boundaries and planned hardening; it does not certify an external deployment.

## Current controls and handling rules

- Keep real `.env` files local or in an approved secret-provisioning system. `DATABASE_URL`, `JWT_SECRET`, bootstrap credentials/hashes, and backup encryption keys are secrets; never commit or place them in a source ZIP. Rotate a secret if it is disclosed.
- `NEXT_PUBLIC_*` values are included in browser-delivered code and must never contain secrets. `NEXT_PUBLIC_API_URL` is configuration, not a credential.
- Backend JWT verification, active-user checks and role/menu authorization are the enforcement boundary. Frontend menu visibility is convenience, not permission enforcement.
- Set `FRONTEND_ORIGIN` to an approved origin. CORS narrows browser origins; it is not authentication.
- Use HTTPS for any production access, and restrict database and administrative access to approved operators. Uploaded statements, donor identities, UI snapshots, exports, logs and backups may contain sensitive data; store, transmit and retain them accordingly.
- The bootstrap seed requires a supplied password to create a missing admin. Never store a real bootstrap password or hash in documentation, scripts, examples or delivery packages.
- Never commit browser page captures or test-debug artifacts. [SOURCE_HANDOFF.md](SOURCE_HANDOFF.md) excludes them from source delivery.

## Planned hardening — not implemented yet

Application-level login rate limiting, a defined production security-header/CSP policy, stricter operational access and auditing, a review of browser token-storage strategy, and production secret provisioning are future work. They are **not implemented by this Phase 0 documentation change**. Their final location may be the application or approved infrastructure; do not assume a reverse proxy currently supplies them.

For source delivery, follow [SOURCE_HANDOFF.md](SOURCE_HANDOFF.md). For planned production topology and backup policy, see [DEPLOYMENT.md](DEPLOYMENT.md) and [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
