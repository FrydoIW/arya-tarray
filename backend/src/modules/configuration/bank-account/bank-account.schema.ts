import { z } from "zod";

const id = z.string().trim().min(1);
const bankCode = z.string().trim().toUpperCase().min(1).max(30);
const accountNo = z.string().trim().min(1).max(100);
const accountName = z.string().trim().min(2).max(200);
const openingBalance = z.string().trim().regex(/^-?\d{1,17}(?:\.\d{1,2})?$/, "Opening Balance must be a valid amount with at most 2 decimal places.");
const openingBalanceDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Balance As Of must be a valid date.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Balance As Of must be a valid date.");

function openingBalancePairIsComplete(value: { openingBalance?: string | null; openingBalanceDate?: string | null }) {
  return (value.openingBalance == null) === (value.openingBalanceDate == null);
}

const bankAccountCreateSchema = z.object({
  clientId: id,
  bankCode,
  accountNo,
  accountName,
  activeFlag: z.boolean(),
  openingBalance: openingBalance.nullable().optional().default(null),
  openingBalanceDate: openingBalanceDate.nullable().optional().default(null)
}).refine(openingBalancePairIsComplete, {
  message: "Opening Balance and Balance As Of must be supplied together or both omitted."
});

const bankAccountUpdateSchema = z.object({
  id,
  input: z.object({
    accountName,
    activeFlag: z.boolean(),
    openingBalance: openingBalance.nullable().optional(),
    openingBalanceDate: openingBalanceDate.nullable().optional()
  })
});

export const bankAccountWorkspaceExecuteSchema = z.object({
  creates: z.array(bankAccountCreateSchema).default([]),
  updates: z.array(bankAccountUpdateSchema).default([])
});

export type BankAccountWorkspaceExecuteInput = z.infer<typeof bankAccountWorkspaceExecuteSchema>;
