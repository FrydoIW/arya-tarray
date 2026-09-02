import { z } from "zod";

const status = z.enum(["ACTIVE", "INACTIVE"]);
const fullName = z.string().trim().min(1, "Full Name wajib diisi").max(150, "Full Name maksimal 150 karakter");
const email = z.string().trim().email("Format Email tidak valid").max(150).transform((value) => value.toLowerCase());
const password = z.string().min(8, "Password minimal 8 karakter").max(128, "Password maksimal 128 karakter");
const roleId = z.string().trim().min(1, "Role wajib dipilih");

const userCreateValueSchema = z.object({
  clientId: z.string().trim().min(1),
  fullName,
  email,
  password,
  roleId,
  status
});

const userUpdateValueSchema = z.object({
  fullName,
  email,
  roleId,
  status
});

const userPasswordResetSchema = z.object({
  id: z.string().trim().min(1),
  password
});

export const userWorkspaceExecuteSchema = z.object({
  creates: z.array(userCreateValueSchema).default([]),
  updates: z.array(z.object({
    id: z.string().trim().min(1),
    input: userUpdateValueSchema
  })).default([]),
  passwordResets: z.array(userPasswordResetSchema).default([])
});

export type UserWorkspaceExecuteInput = z.infer<typeof userWorkspaceExecuteSchema>;
