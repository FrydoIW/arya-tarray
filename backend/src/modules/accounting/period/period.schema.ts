import { z } from "zod";

export const dateOnly = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

export const fiscalYearSchema = z.object({
  yearCode: z.string().trim().min(1).max(20),
  startDate: dateOnly,
  endDate: dateOnly
}).refine(value => value.startDate <= value.endDate, { path: ["endDate"], message: "End date precedes start date" });

export const periodSchema = z.object({
  fiscalYearId: z.string().uuid(),
  periodNo: z.number().int().min(1).max(53),
  periodCode: z.string().trim().min(1).max(20),
  startDate: dateOnly,
  endDate: dateOnly
}).refine(value => value.startDate <= value.endDate, { path: ["endDate"], message: "End date precedes start date" });

export type FiscalYearInput = z.infer<typeof fiscalYearSchema>;
export type PeriodInput = z.infer<typeof periodSchema>;
