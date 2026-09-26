import { z } from "zod";
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(5).max(50).default(10);
const monthStart = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "windowStart must be the first day of a month").refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "windowStart must be a valid calendar date");
export const timeBasedMonitoringQuerySchema = z.object({
  timelinePage: page,
  timelinePageSize: pageSize,
  timelineFilter: z.enum(["ALL", "HAS_CARRY", "EXPIRING", "NO_COVERAGE", "EXPIRED"]).default("ALL"),
  windowStart: monthStart.optional()
});
export type TimeBasedMonitoringQuery = z.infer<typeof timeBasedMonitoringQuerySchema>;
