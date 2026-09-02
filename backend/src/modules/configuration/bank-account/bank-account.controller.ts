import type { Request, Response } from "express";
import { bankAccountWorkspaceExecuteSchema } from "./bank-account.schema.js";
import {
  executeBankAccountWorkspace,
  getBankAccountWorkspace
} from "./bank-account.service.js";

export async function getBankAccountWorkspaceController(_req: Request, res: Response) {
  res.json(await getBankAccountWorkspace());
}

export async function executeBankAccountWorkspaceController(req: Request, res: Response) {
  const input = bankAccountWorkspaceExecuteSchema.parse(req.body);
  res.json(await executeBankAccountWorkspace(input, req.auth!.userId));
}
