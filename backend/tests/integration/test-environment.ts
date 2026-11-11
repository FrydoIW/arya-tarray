import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { requireSafeTestDatabaseUrl } from "./test-database.js";

const selectionKeys = new Set(["ARYA_ENV", "DATABASE_URL", "TEST_DATABASE_URL", "ALLOW_DEV_INTEGRATION_WRITES",
  "ALLOW_TEST_INTEGRATION_WRITES", "ACCOUNTING_CUTOVER_DATE"]);

/** Never print conflicting values: they may contain credentials. */
export function applyBackendTestEnvironment(local: Record<string, string>, inherited: NodeJS.ProcessEnv): void {
  const target = requireSafeTestDatabaseUrl(inherited.TEST_DATABASE_URL, inherited.DATABASE_URL,
    { aryaEnv: inherited.ARYA_ENV, allowWrites: inherited.ALLOW_TEST_INTEGRATION_WRITES });
  // Only this test process selects TEST. Never copy DEV connection or cutover from .env.
  inherited.DATABASE_URL = target;
  for (const [key, value] of Object.entries(local)) {
    if (!selectionKeys.has(key)) inherited[key] ??= value;
  }
}

export function loadBackendTestEnvironment(): void {
  // Explicit backend/.env only. Reference .txt files and Git branches never choose an environment.
  const path = fileURLToPath(new URL("../../.env", import.meta.url));
  applyBackendTestEnvironment(parse(readFileSync(path)), process.env);
}
