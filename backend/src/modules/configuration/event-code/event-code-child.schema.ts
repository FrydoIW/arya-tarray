import { z } from "zod";

export const childValueSchema = z.object({
  eventCodeId: z.string().uuid(),
  childCode: z.string().trim().min(1, "Child Code is required").max(30),
  childName: z.string().trim().min(1, "Child name is required").max(150),
  description: z.string().trim().max(500).nullable(),
  displayOrder: z.number().int().min(0).max(9999),
  activeFlag: z.boolean()
});

export const childExecuteSchema = z.object({
  creates: z.array(childValueSchema).default([]),
  updates: z.array(z.object({ id: z.string().uuid(), input: childValueSchema })).default([]),
  deletes: z.array(z.string().uuid()).default([])
}).refine((value) => value.creates.length + value.updates.length + value.deletes.length > 0, {
  message: "No Child changes to Execute"
});

export type ChildExecuteInput = z.infer<typeof childExecuteSchema>;
export type ChildValueInput = z.infer<typeof childValueSchema>;
