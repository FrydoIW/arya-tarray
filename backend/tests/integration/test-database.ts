export const DEV_DATABASE = "arya_tarray_dev";
export const TEST_DATABASE = "arya_tarray_test";

export type WriteAcknowledgment = { aryaEnv: string | undefined; allowWrites: string | undefined };

function localTestUrl(value: string | undefined, name: string): URL {
  if (!value?.trim()) throw new Error(`${name} is required for isolated integration tests.`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid MySQL URL.`); }
  if (parsed.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Integration tests require a loopback MySQL host.");
  }
  // Reject connection redirects (including MySQL socket parameters) and ambiguous names.
  if (parsed.pathname !== `/${TEST_DATABASE}` || parsed.search || parsed.hash) {
    throw new Error(`Integration tests require exactly ${TEST_DATABASE}, without URL query/fragment overrides.`);
  }
  return parsed;
}

/** Pure allowlist; run before importing application/fixture modules or connecting. */
export function requireSafeTestDatabaseUrl(testUrl: string | undefined, applicationUrl: string | undefined,
  acknowledgment: WriteAcknowledgment): string {
  if (acknowledgment.aryaEnv !== "TEST") throw new Error("Integration tests require ARYA_ENV=TEST.");
  if (acknowledgment.allowWrites !== "true") throw new Error("Integration tests require ALLOW_TEST_INTEGRATION_WRITES=true.");
  const target = localTestUrl(testUrl, "TEST_DATABASE_URL");
  if (applicationUrl !== undefined && localTestUrl(applicationUrl, "DATABASE_URL").href !== target.href) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL conflict; both must select the same TEST connection.");
  }
  return target.href;
}

export function assertConnectedDevDatabase(actual: string | null | undefined): void {
  if (actual !== DEV_DATABASE) throw new Error("SELECT DATABASE() mismatch: refusing DEV schema inspection.");
}

export function assertConnectedTestDatabase(actual: string | null | undefined): void {
  if (actual !== TEST_DATABASE) throw new Error("SELECT DATABASE() mismatch: refusing integration fixture writes.");
}
