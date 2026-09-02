import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http.js";
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

export async function login(input: LoginInput) {
  const email = input.email.trim().toLowerCase();
  const user = await findUserByEmail(email);

  if (
    !user ||
    user.status !== "ACTIVE" ||
    !(await bcrypt.compare(input.password, user.passwordHash))
  ) {
    throw new HttpError(401, "Email atau password tidak valid");
  }

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
