/** Guard before importing application modules, constructing Prisma, or making any database call. */
export function requireSafeTestDatabaseUrl(testUrl: string | undefined, applicationUrl: string | undefined): string {
  if (!testUrl?.trim()) throw new Error("TEST_DATABASE_URL is required for MySQL integration tests.");
  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid MySQL URL.");
  }
  if (parsed.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Integration tests require a loopback MySQL host.");
  }
  if (decodeURIComponent(parsed.pathname) !== "/arya_tarray_test") {
    throw new Error("Integration tests require the dedicated arya_tarray_test database.");
  }
  if (applicationUrl?.trim()) {
    try {
      const app = new URL(applicationUrl);
      if (app.protocol === parsed.protocol && app.hostname === parsed.hostname && (app.port || "3306") === (parsed.port || "3306")
        && decodeURIComponent(app.pathname) === decodeURIComponent(parsed.pathname)) {
        throw new Error("TEST_DATABASE_URL must not target the configured application database.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TEST_DATABASE_URL must not")) throw error;
      // A malformed application URL cannot make the exact, loopback test-db allowlist less strict.
    }
  }
  return testUrl;
}
