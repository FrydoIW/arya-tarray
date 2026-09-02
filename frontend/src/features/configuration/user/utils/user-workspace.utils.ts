import type { UserItem, UserRoleOption, UserUpdateInput } from "../types";

export function normalizeUserUpdate(item: UserItem): UserUpdateInput {
  return {
    fullName: item.fullName.trim(),
    email: item.email.trim().toLowerCase(),
    roleId: item.roleId,
    status: item.status
  };
}

export function sameUserUpdate(a: UserUpdateInput, b: UserUpdateInput) {
  return a.fullName === b.fullName
    && a.email === b.email
    && a.roleId === b.roleId
    && a.status === b.status;
}

export function validateUsers(items: UserItem[], roles: UserRoleOption[]) {
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const emails = new Set<string>();

  for (const [index, item] of items.entries()) {
    const row = index + 1;
    const fullName = item.fullName.trim();
    const email = item.email.trim().toLowerCase();

    if (!fullName) return `Row ${row}: Full Name wajib diisi.`;
    if (fullName.length > 150) return `Row ${row}: Full Name maksimal 150 karakter.`;
    if (!/^\S+@\S+\.\S+$/.test(email)) return `Row ${row}: format Email tidak valid.`;
    if (email.length > 150) return `Row ${row}: Email maksimal 150 karakter.`;
    if (emails.has(email)) return `Email ${email} digunakan lebih dari satu user.`;
    emails.add(email);

    const role = rolesById.get(item.roleId);
    if (!item.roleId || !role) return `Row ${row}: Role wajib dipilih.`;
    if (item.isDraft && !role.activeFlag) return `Row ${row}: Role inactive tidak dapat di-assign ke user baru.`;

    if (!item.isDraft && item.roleCount > 1) {
      const originalRoleId = item.role?.id ?? "";
      if (item.roleId !== originalRoleId) {
        return `Row ${row}: user memiliki multiple role dan tidak dapat diubah pada mode single-role.`;
      }
    }

    if (item.isDraft && (item.draftPassword ?? "").length < 8) {
      return `Row ${row}: Password user baru minimal 8 karakter.`;
    }
  }

  return "";
}
