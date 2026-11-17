import { z } from "zod";

const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Invalid unit amount").refine((value) => Number(value) > 0, "Unit amount must be greater than zero").nullable();

export const childValueSchema = z.object({
  eventCodeId: z.string().uuid(),
  childCode: z.string().trim().min(1, "Child Code is required").max(30),
  childName: z.string().trim().min(1, "Child name is required").max(150),
  description: z.string().trim().max(500).nullable(),
  displayOrder: z.number().int().min(0).max(9999),
  activeFlag: z.boolean(),
  capacity: z.number().int().min(1, "Capacity must be a positive integer").max(1_000_000_000).nullable(),
  unitAmount: amount,
  durationMonths: z.number().int().min(1).max(1200).nullable()
}).refine((value) => {
  const configured = [value.capacity !== null, value.unitAmount !== null, value.durationMonths !== null];
  return configured.every(Boolean) || configured.every((item) => !item);
}, { message: "Subscription configuration must be complete: capacity, unit amount, and duration together." });

export const childExecuteSchema = z.object({
  creates: z.array(childValueSchema).default([]),
  updates: z.array(z.object({ id: z.string().uuid(), input: childValueSchema })).default([]),
  deletes: z.array(z.string().uuid()).default([])
}).refine((value) => value.creates.length + value.updates.length + value.deletes.length > 0, {
  message: "No Child changes to Execute"
});

export type ChildExecuteInput = z.infer<typeof childExecuteSchema>;
export type ChildValueInput = z.infer<typeof childValueSchema>;
