import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

// Retry the whole transaction after a serialization/deadlock abort; never partially retry its writes.
export async function memberTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
    } catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && ["1213", "1205"].includes(String(error.meta?.code))));
      if (!retry || attempt >= 3) throw error;
    }
  }
}
