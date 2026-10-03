# Planned production architecture — not implemented yet

This is a deployment **plan**, not an executable runbook. The repository currently contains no Dockerfile, Docker Compose stack, Nginx configuration or production deployment script. Do not infer that the target host, storage, firewall, certificates, monitoring or backups have been provisioned.

## Approved target concept

Target host: **Jagoan Hosting Universe**, 6 Core CPU, 6 GB RAM, 200 GB SSD, Ubuntu 24.04 LTS. Actual capacity, ownership and operating procedures must be verified before release.

```text
Internet
  → Domain / HTTPS
  → Nginx reverse proxy
  → Docker Compose
      → Next.js frontend
      → Node.js / Express backend
      → MySQL with persistent volume
```

This topology is **planned / not implemented yet**. Public ingress is intended to be limited to ports 80/443, with HTTPS as the normal access path; MySQL must not be publicly exposed. Firewall rules, SSH/admin access and container-network boundaries require an approved configuration.

## Items required before an executable deployment procedure

- Define domain/DNS, certificate issuance/renewal, Nginx routing, trusted proxy behavior and HTTPS verification.
- Define reproducible image builds, Compose service/volume/network configuration, MySQL persistence and resource budgets. Do not place live secrets in images or source control.
- Provision environment variables and secret rotation for frontend API URL, backend DB URL/JWT key, CORS origin and bootstrap controls; distinguish public browser configuration from secrets.
- Define liveness and database-readiness checks. The current backend `/health` endpoint reports process liveness only; it does not verify MySQL availability.
- Define logs, rotation, alerting/monitoring, access retention and graceful shutdown. The backend currently handles SIGINT/SIGTERM and disconnects Prisma, but platform behavior remains to be tested.
- Make a verified backup and recovery plan a release prerequisite. Review the physical target and the manual SQL patch record under [DATABASE.md](DATABASE.md); no migration or patch should run implicitly from a container.
- Define release ordering, smoke checks, failure decision points and rollback of application images/configuration. Plan database recovery separately; do not assume SQL DDL is safely reversible.

No Docker, Nginx, firewall, backup or deployment commands are implemented by this document. See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the planned recovery policy and [SECURITY.md](SECURITY.md) for secret-handling principles.
