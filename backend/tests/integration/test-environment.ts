import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const selectionKeys = ["ARYA_ENV", "DATABASE_URL", "TEST_DATABASE_URL", "ALLOW_DEV_INTEGRATION_WRITES", "ACCOUNTING_CUTOVER_DATE"] as const;

/** Never print conflicting values: they may contain credentials. */
export function applyBackendTestEnvironment(local: Record<string, string>, inherited: NodeJS.ProcessEnv): void {
  for (const key of selectionKeys) {
    if (inherited[key] !== undefined && inherited[key] !== local[key]) {
      throw new Error(`Stale/conflicting ${key}; clear the inherited variable and review backend/.env.`);
    }
  }
  for (const [key, value] of Object.entries(local)) inherited[key] ??= value;
}

export function loadBackendTestEnvironment(): void {
  // Explicit backend/.env only. Reference .txt files and Git branches never choose an environment.
  const path = fileURLToPath(new URL("../../.env", import.meta.url));
  applyBackendTestEnvironment(parse(readFileSync(path)), process.env);
}
