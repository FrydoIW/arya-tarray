import { after } from "node:test";
import { requireSafeTestDatabaseUrl } from "./test-database.js";
import { loadBackendTestEnvironment } from "./test-environment.js";
import { verifyDevDatabase } from "./dev-preflight.js";

// Safety check must precede every import of production code or fixture code.
loadBackendTestEnvironment();
process.env.DATABASE_URL = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
  { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_DEV_INTEGRATION_WRITES });

const { prisma } = await import("../../src/lib/prisma.js");
after(async () => prisma.$disconnect());
await verifyDevDatabase(prisma);
await import("./financial-flow.test.js");
await import("./accounting-foundation.test.js");
await import("./accounting-flow.test.js");
