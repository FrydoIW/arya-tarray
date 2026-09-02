import { z } from "zod";

const id = z.string().trim().min(1);
const bankCode = z.string().trim().toUpperCase().min(1).max(30);
const accountNo = z.string().trim().min(1).max(100);
const accountName = z.string().trim().min(2).max(200);

const bankAccountCreateSchema = z.object({
  clientId: id,
  bankCode,
  accountNo,
  accountName,
  activeFlag: z.boolean()
});

const bankAccountUpdateSchema = z.object({
  id,
  input: z.object({
    accountName,
    activeFlag: z.boolean()
  })
});

export const bankAccountWorkspaceExecuteSchema = z.object({
  creates: z.array(bankAccountCreateSchema).default([]),
  updates: z.array(bankAccountUpdateSchema).default([])
});

export type BankAccountWorkspaceExecuteInput = z.infer<typeof bankAccountWorkspaceExecuteSchema>;
