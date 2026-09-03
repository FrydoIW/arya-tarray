import { z } from "zod";

const code = z.string().trim().regex(/^\d{3}$/, "Code harus terdiri dari tepat 3 digit");
const eventName = z.string().trim().min(1, "Event name wajib diisi").max(150);
const category = z
  .union([z.string().trim().max(50), z.null()])
  .optional()
  .transform((value) => value || null);

const eventCodeExecuteValueSchema = z.object({
  code,
  eventName,
  category,
  description: z.string().trim().max(500).nullable(),
  activeFlag: z.boolean()
});

export const eventCodeExecuteSchema = z
  .object({
    creates: z.array(eventCodeExecuteValueSchema).default([]),
    updates: z.array(z.object({
      id: z.string().trim().min(1),
      input: eventCodeExecuteValueSchema
    })).default([]),
    deletes: z.array(z.string().trim().min(1)).default([])
  })
  .refine(
    (value) => value.creates.length > 0 || value.updates.length > 0 || value.deletes.length > 0,
    { message: "Tidak ada perubahan untuk dieksekusi" }
  );

export const eventCodeListSchema = z.object({
  search: z.string().trim().optional()
});

export type EventCodeExecuteInput = z.infer<typeof eventCodeExecuteSchema>;
