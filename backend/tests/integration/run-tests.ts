import { after } from "node:test";
import { requireSafeTestDatabaseUrl } from "./test-database.js";
import { loadBackendTestEnvironment } from "./test-environment.js";
import { verifyTestDatabase } from "./dev-preflight.js";

// Safety check must precede every import of production code or fixture code.
loadBackendTestEnvironment();
process.env.DATABASE_URL = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
  { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });

const { prisma } = await import("../../src/lib/prisma.js");
after(async () => prisma.$disconnect());
await verifyTestDatabase(prisma);
await import("./financial-flow.test.js");
await import("./accounting-foundation.test.js");
await import("./accounting-flow.test.js");
await import("./accounting-ledger-rollback.test.js");
await import("./accounting-approval-flow.test.js");
await import("./apar-flow.test.js");
await import("./schedule-flow.test.js");
await import("./asset-flow.test.js");
await import("./fund-flow.test.js");
await import("./finalization-flow.test.js");
await import("./audit-remediation-flow.test.js");
