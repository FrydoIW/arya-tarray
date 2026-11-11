import type { Request, Response } from "express";
import { z } from "zod";
import { accountQuerySchema, createAccountSchema, updateAccountSchema } from "./coa.schema.js";
import { createAccount, listAccounts, updateAccount } from "./coa.service.js";

export async function listAccountsController(req: Request, res: Response) {
  res.json(await listAccounts(accountQuerySchema.parse(req.query)));
}

export async function createAccountController(req: Request, res: Response) {
  res.status(201).json(await createAccount(createAccountSchema.parse(req.body)));
}

export async function updateAccountController(req: Request, res: Response) {
  res.json(await updateAccount(z.string().uuid().parse(req.params.accountId), updateAccountSchema.parse(req.body)));
}
