import { z } from "zod";
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(5).max(50).default(10);
export const timeBasedMonitoringQuerySchema = z.object({ carryPage: page, carryPageSize: pageSize, expiryPage: page, expiryPageSize: pageSize });
export type TimeBasedMonitoringQuery = z.infer<typeof timeBasedMonitoringQuerySchema>;
