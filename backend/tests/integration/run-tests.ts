import { after } from "node:test";
import { requireSafeTestDatabaseUrl } from "./test-database.js";

// Safety check must precede every import of production code or fixture code.
process.env.DATABASE_URL = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);

const { prisma } = await import("../../src/lib/prisma.js");
after(async () => prisma.$disconnect());
await import("./financial-flow.test.js");
