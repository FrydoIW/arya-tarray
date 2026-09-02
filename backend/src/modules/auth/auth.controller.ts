import type { Request, Response } from "express";
import { loginSchema } from "./auth.schema.js";
import { getCurrentUser, login } from "./auth.service.js";

export async function loginController(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  res.json(await login(input));
}

export async function meController(req: Request, res: Response) {
  res.json(await getCurrentUser(req.auth!.userId));
}
