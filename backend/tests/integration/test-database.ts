export const DEV_DATABASE = "arya_tarray_dev";

export type WriteAcknowledgment = { aryaEnv: string | undefined; allowWrites: string | undefined };

function localDevUrl(value: string | undefined, name: string): URL {
  if (!value?.trim()) throw new Error(`${name} is required for DEV integration tests.`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid MySQL URL.`); }
  if (parsed.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Integration tests require a loopback MySQL host.");
  }
  // Reject connection redirects (including MySQL socket parameters) and ambiguous names.
  if (parsed.pathname !== `/${DEV_DATABASE}` || parsed.search || parsed.hash) {
    throw new Error(`Integration tests require exactly ${DEV_DATABASE}, without URL query/fragment overrides.`);
  }
  return parsed;
}

/** Pure allowlist; run before importing application/fixture modules or connecting. */
export function requireSafeTestDatabaseUrl(testUrl: string | undefined, applicationUrl: string | undefined,
  acknowledgment: WriteAcknowledgment): string {
  if (acknowledgment.aryaEnv !== "DEV") throw new Error("Integration tests require ARYA_ENV=DEV.");
  if (acknowledgment.allowWrites !== "true") throw new Error("Integration tests require ALLOW_DEV_INTEGRATION_WRITES=true.");
  const target = localDevUrl(testUrl, "TEST_DATABASE_URL");
  const application = localDevUrl(applicationUrl, "DATABASE_URL");
  // Both URLs intentionally share DEV. Refuse stale credentials/ports/hosts rather than silently overriding.
  if (target.href !== application.href) throw new Error("DATABASE_URL and TEST_DATABASE_URL conflict; both must select the same DEV connection.");
  return testUrl!;
}

export function assertConnectedDevDatabase(actual: string | null | undefined): void {
  if (actual !== DEV_DATABASE) throw new Error("SELECT DATABASE() mismatch: refusing integration fixture writes.");
}
