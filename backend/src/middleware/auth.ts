import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

interface TokenPayload extends jwt.JwtPayload {
  sub: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;

    if (!payload.sub) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    req.auth = { userId: payload.sub };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
