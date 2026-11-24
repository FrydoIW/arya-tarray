import type { Request, Response } from "express";
import { loginSchema } from "./auth.schema.js";
import { getCurrentUser, login, LoginRateLimitError } from "./auth.service.js";

export async function loginController(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  try {
    res.json(await login(input, req.ip || req.socket.remoteAddress || "unknown"));
  } catch (error) {
    if (error instanceof LoginRateLimitError) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    throw error;
  }
}

export async function meController(req: Request, res: Response) {
  res.json(await getCurrentUser(req.auth!.userId));
}
