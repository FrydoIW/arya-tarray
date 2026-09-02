import bcrypt from "bcryptjs";
import { HttpError } from "../../../lib/http.js";
import type { UserWorkspaceExecuteInput } from "./user.schema.js";
import {
  applyUserWorkspaceAtomic,
  loadUserWorkspace
} from "./user.repository.js";

type UserWorkspace = Awaited<ReturnType<typeof loadUserWorkspace>>;

function mapRole(role: UserWorkspace["roles"][number]) {
  return {
    id: role.id,
    roleCode: role.roleCode,
    roleName: role.roleName,
    description: role.description,
    activeFlag: role.activeFlag
  };
}

function mapUser(user: UserWorkspace["users"][number]) {
  const assignedRole = user.userRoles
    .map((item) => item.role)
    .sort((a, b) => Number(b.activeFlag) - Number(a.activeFlag) || a.roleCode.localeCompare(b.roleCode))[0] ?? null;

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    status: user.status,
    role: assignedRole
      ? {
          id: assignedRole.id,
          roleCode: assignedRole.roleCode,
          roleName: assignedRole.roleName,
          activeFlag: assignedRole.activeFlag
        }
      : null,
    roleCount: user.userRoles.length,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy
      ? {
          id: user.updatedBy.id,
          fullName: user.updatedBy.fullName
        }
      : null
  };
}

function toWorkspaceResponse(workspace: UserWorkspace) {
  return {
    users: workspace.users.map(mapUser),
    roles: workspace.roles.map(mapRole)
  };
}

function assertUniqueIds(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new HttpError(400, `${label} berisi ID duplikat`);
    }
    seen.add(value);
  }
}

function assertRoleCanBeAssigned(args: {
  roleId: string;
  email: string;
  activeRoleIds: Set<string>;
  currentRoleId?: string;
}) {
  if (args.activeRoleIds.has(args.roleId)) return;

  // Existing users may keep their already-assigned inactive role so admins can
  // still repair identity/status data without silently changing authorization.
  if (args.currentRoleId && args.currentRoleId === args.roleId) return;

  throw new HttpError(400, `Role untuk ${args.email} sudah inactive dan tidak dapat di-assign`);
}

export async function getUserWorkspace() {
  return toWorkspaceResponse(await loadUserWorkspace());
}

export async function executeUserWorkspace(input: UserWorkspaceExecuteInput, actorUserId: string) {
  const workspace = await loadUserWorkspace();
  const existingUsersById = new Map(workspace.users.map((item) => [item.id, item]));
  const existingRoleIds = new Set(workspace.roles.map((item) => item.id));
  const activeRoleIds = new Set(workspace.roles.filter((item) => item.activeFlag).map((item) => item.id));

  assertUniqueIds(input.updates.map((item) => item.id), "User updates");
  assertUniqueIds(input.passwordResets.map((item) => item.id), "Password resets");

  for (const update of input.updates) {
    const existing = existingUsersById.get(update.id);

    if (!existing) {
      throw new HttpError(404, "User yang akan diubah tidak ditemukan");
    }

    if (existing.userRoles.length > 1) {
      throw new HttpError(
        409,
        `User ${existing.email} memiliki lebih dari satu role dan tidak dapat diedit pada mode single-role`
      );
    }

    if (!existingRoleIds.has(update.input.roleId)) {
      throw new HttpError(400, `Role untuk ${update.input.email} tidak valid`);
    }

    assertRoleCanBeAssigned({
      roleId: update.input.roleId,
      email: update.input.email,
      activeRoleIds,
      currentRoleId: existing.userRoles[0]?.role.id
    });
  }

  for (const create of input.creates) {
    if (!existingRoleIds.has(create.roleId)) {
      throw new HttpError(400, `Role untuk ${create.email} tidak valid`);
    }

    assertRoleCanBeAssigned({
      roleId: create.roleId,
      email: create.email,
      activeRoleIds
    });
  }

  for (const reset of input.passwordResets) {
    if (!existingUsersById.has(reset.id)) {
      throw new HttpError(404, "User untuk reset password tidak ditemukan");
    }
  }

  // Validate the final workspace instead of only each request item. The DB intentionally
  // stays minimal, so duplicate-email protection belongs here in the business layer.
  const finalEmailByUser = new Map(
    workspace.users.map((item) => [item.id, item.email.trim().toLowerCase()])
  );

  for (const update of input.updates) {
    finalEmailByUser.set(update.id, update.input.email.trim().toLowerCase());
  }

  const usedEmails = new Map<string, string>();
  for (const [userId, email] of finalEmailByUser) {
    const owner = usedEmails.get(email);
    if (owner && owner !== userId) {
      throw new HttpError(400, `Email ${email} sudah digunakan user lain`);
    }
    usedEmails.set(email, userId);
  }

  for (const create of input.creates) {
    const email = create.email.trim().toLowerCase();
    if (usedEmails.has(email)) {
      throw new HttpError(400, `Email ${email} sudah digunakan user lain`);
    }
    usedEmails.set(email, create.clientId);
  }

  const [creates, passwordResets] = await Promise.all([
    Promise.all(input.creates.map(async (item) => ({
      fullName: item.fullName.trim(),
      email: item.email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(item.password, 12),
      roleId: item.roleId,
      status: item.status
    }))),
    Promise.all(input.passwordResets.map(async (item) => ({
      id: item.id,
      passwordHash: await bcrypt.hash(item.password, 12)
    })))
  ]);

  const result = await applyUserWorkspaceAtomic({
    creates,
    updates: input.updates.map((item) => ({
      id: item.id,
      input: {
        fullName: item.input.fullName.trim(),
        email: item.input.email.trim().toLowerCase(),
        roleId: item.input.roleId,
        status: item.input.status
      }
    })),
    passwordResets,
    actorUserId
  });

  return {
    changedCount: input.creates.length + input.updates.length + input.passwordResets.length,
    ...toWorkspaceResponse(result)
  };
}
