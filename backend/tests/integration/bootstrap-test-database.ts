import { loadBackendTestEnvironment } from "./test-environment.js";
import { requireSafeTestDatabaseUrl } from "./test-database.js";
import { verifyDevDatabase } from "./dev-preflight.js";

async function main() {
  loadBackendTestEnvironment();
  process.env.DATABASE_URL = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
    { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_DEV_INTEGRATION_WRITES });
  const { prisma } = await import("../../src/lib/prisma.js");
  try {
    await verifyDevDatabase(prisma);
    process.stdout.write("arya_tarray_dev preflight passed; no schema or data was changed.\n");
  } finally { await prisma.$disconnect(); }
}

main().catch(() => {
  process.stderr.write("DEV preflight failed. Review env selection, connection, current schema and Accounting configuration. No provisioning/reset was attempted.\n");
  process.exitCode = 1;
});
