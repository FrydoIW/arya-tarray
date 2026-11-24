import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import type { LoginInput } from "./auth.schema.js";
import { findUserByEmail, findUserById } from "./auth.repository.js";

type UserWithRoles = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

function mapUser(user: UserWithRoles) {
  const roles = user.userRoles
    .map(({ role }) => ({
      id: role.id,
      roleCode: role.roleCode,
      roleName: role.roleName,
      activeFlag: role.activeFlag
    }))
    .filter((role) => role.activeFlag);

  const roleCode = roles.find((role) => role.roleCode === "ADMIN")?.roleCode
    ?? roles[0]?.roleCode
    ?? "NO_ROLE";

  const menuCodes = Array.from(new Set(
    user.userRoles.flatMap(({ role }) => {
      if (!role.activeFlag) return [];
      return role.roleMenus
        .filter(({ menu }) => menu.activeFlag && menu.menuType === "PAGE")
        .map(({ menu }) => menu.menuCode);
    })
  )).sort();

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    status: user.status,
    roleCode,
    roles,
    menuCodes
  };
}

export class LoginRateLimitError extends HttpError {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "Terlalu banyak percobaan masuk. Silakan coba lagi nanti.");
    this.name = "LoginRateLimitError";
  }
}

function throttleKey(email: string, sourceIp: string) {
  return createHash("sha256").update(JSON.stringify([email, sourceIp.trim().toLowerCase()])).digest("hex");
}

async function assertLoginAllowed(key: string, now: Date) {
  const throttle = await prisma.loginThrottle.findUnique({ where: { throttleKey: key }, select: { blockedUntil: true } });
  if (throttle?.blockedUntil && throttle.blockedUntil > now) {
    throw new LoginRateLimitError(Math.max(1, Math.ceil((throttle.blockedUntil.getTime() - now.getTime()) / 1000)));
  }
}

async function recordLoginFailure(key: string, now: Date) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT throttle_key FROM arya_login_throttle WHERE throttle_key = ${key} FOR UPDATE`);
        const current = await tx.loginThrottle.findUnique({ where: { throttleKey: key } });
        const expiredWindow = !current || now.getTime() - current.windowStart.getTime() >= env.loginRateLimitWindowMs;
        const failureCount = expiredWindow ? 1 : current.failureCount + 1;
        const blockedUntil = failureCount >= env.loginRateLimitMaxFailures ? new Date(now.getTime() + env.loginRateLimitCooldownMs) : null;
        const row = await tx.loginThrottle.upsert({ where: { throttleKey: key }, create: {
          throttleKey: key, windowStart: now, failureCount, blockedUntil
        }, update: { windowStart: expiredWindow ? now : current!.windowStart, failureCount, blockedUntil } });
        return row.blockedUntil;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (result && result > now) throw new LoginRateLimitError(Math.max(1, Math.ceil((result.getTime() - now.getTime()) / 1000)));
      return;
    } catch (error) {
      if (error instanceof LoginRateLimitError) throw error;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
      if (!retryable || attempt === 4) throw error;
    }
  }
}

export async function login(input: LoginInput, sourceIp: string) {
  const email = input.email.trim().toLowerCase();
  const key = throttleKey(email, sourceIp);
  const now = new Date();
  await assertLoginAllowed(key, now);
  const user = await findUserByEmail(email);

  if (
    !user ||
    user.status !== "ACTIVE" ||
    !(await bcrypt.compare(input.password, user.passwordHash))
  ) {
    await recordLoginFailure(key, now);
    throw new HttpError(401, "Email atau password tidak valid");
  }

  await prisma.loginThrottle.deleteMany({ where: { throttleKey: key } });

  const token = jwt.sign({}, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"]
  });

  return {
    token,
    user: mapUser(user)
  };
}

export async function getCurrentUser(userId: string) {
  const user = await findUserById(userId);

  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "User tidak aktif atau tidak ditemukan");
  }

  return mapUser(user);
}
