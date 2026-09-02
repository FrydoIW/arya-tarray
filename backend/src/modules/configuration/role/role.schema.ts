import { z } from "zod";

const roleCode = z
  .string()
  .trim()
  .min(1, "Role Code wajib diisi")
  .max(50, "Role Code maksimal 50 karakter")
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z0-9_]+$/.test(value), {
    message: "Role Code hanya boleh berisi huruf besar, angka, dan underscore"
  });

const roleName = z.string().trim().min(1, "Role Name wajib diisi").max(100);
const roleDescription = z.string().trim().max(255).nullable();

const roleCreateValueSchema = z.object({
  roleCode,
  roleName,
  description: roleDescription,
  activeFlag: z.boolean()
});

const roleUpdateValueSchema = z.object({
  roleName,
  description: roleDescription,
  activeFlag: z.boolean()
});

const roleChangesSchema = z.object({
  creates: z.array(roleCreateValueSchema).default([]),
  updates: z.array(z.object({
    id: z.string().trim().min(1),
    input: roleUpdateValueSchema
  })).default([]),
  deletes: z.array(z.string().trim().min(1)).default([])
});

const menuCode = z
  .string()
  .trim()
  .min(1, "Menu Code wajib diisi")
  .max(100, "Menu Code maksimal 100 karakter")
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z0-9_]+$/.test(value), {
    message: "Menu Code hanya boleh berisi huruf besar, angka, dan underscore"
  });

const menuName = z.string().trim().min(1, "Menu Name wajib diisi").max(150);
const menuRoute = z.string().trim().max(255).nullable();
const menuType = z.enum(["GROUP", "PAGE"]);
const menuParentRef = z.string().trim().min(1).nullable();

const menuCreateValueSchema = z.object({
  clientId: z.string().trim().min(1),
  parentMenuRef: menuParentRef,
  menuCode,
  menuName,
  route: menuRoute,
  menuType,
  displayOrder: z.number().int().min(0),
  activeFlag: z.boolean()
}).superRefine((value, context) => {
  if (value.menuType === "GROUP" && value.parentMenuRef !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentMenuRef"], message: "Group menu tidak boleh memiliki parent" });
  }
  if (value.menuType === "GROUP" && value.route !== null && value.route !== "") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["route"], message: "Group menu tidak menggunakan route" });
  }
  if (value.menuType === "PAGE" && !value.parentMenuRef) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentMenuRef"], message: "Page menu wajib memiliki parent group" });
  }
  if (value.menuType === "PAGE" && !value.route) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["route"], message: "Page menu wajib memiliki route" });
  }
});

const menuUpdateValueSchema = z.object({
  parentMenuRef: menuParentRef,
  menuName,
  displayOrder: z.number().int().min(0),
  activeFlag: z.boolean()
});

const menuChangesSchema = z.object({
  creates: z.array(menuCreateValueSchema).default([]),
  updates: z.array(z.object({
    id: z.string().trim().min(1),
    input: menuUpdateValueSchema
  })).default([]),
  deletes: z.array(z.string().trim().min(1)).default([])
});

const roleMenuAssignmentSchema = z.object({
  roleId: z.string().trim().min(1),
  menuId: z.string().trim().min(1)
});

export const roleWorkspaceExecuteSchema = z.object({
  roles: roleChangesSchema.default({ creates: [], updates: [], deletes: [] }),
  menus: menuChangesSchema.default({ creates: [], updates: [], deletes: [] }),
  roleMenus: z.array(roleMenuAssignmentSchema).nullable().optional()
});

export const roleListSchema = z.object({
  search: z.string().trim().optional()
});

export type RoleWorkspaceExecuteInput = z.infer<typeof roleWorkspaceExecuteSchema>;
