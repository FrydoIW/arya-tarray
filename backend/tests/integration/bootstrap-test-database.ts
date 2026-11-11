import { loadBackendTestEnvironment } from "./test-environment.js";
import { requireSafeTestDatabaseUrl } from "./test-database.js";
import { verifyTestDatabase } from "./dev-preflight.js";

async function main() {
  loadBackendTestEnvironment();
  process.env.DATABASE_URL = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
    { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
  const { prisma } = await import("../../src/lib/prisma.js");
  try {
    await verifyTestDatabase(prisma);
    process.stdout.write("arya_tarray_test preflight passed; no schema or data was changed.\n");
  } finally { await prisma.$disconnect(); }
}

main().catch(() => {
  process.stderr.write("TEST preflight failed. Review explicit TEST selection and approved schema provisioning. No provisioning/reset was attempted.\n");
  process.exitCode = 1;
});
