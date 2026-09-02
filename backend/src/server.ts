import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(env.port, () => {
  console.log(`Arya Tarray backend running on http://localhost:${env.port}`);
  console.log(`Health check: http://localhost:${env.port}/health`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
