import { HttpError } from "../../../lib/http.js";
import type { ApprovalWorkspaceExecuteInput } from "./approval.schema.js";
import {
  applyApprovalWorkspaceAtomic,
  loadApprovalWorkspace as loadApprovalWorkspaceRecords,
  SUPPORTED_APPROVAL_MENU_CODE
} from "./approval.repository.js";

type WorkspaceRecord = Awaited<ReturnType<typeof loadApprovalWorkspaceRecords>>;
type ConfigRecord = WorkspaceRecord["configurations"][number];
type MenuRecord = WorkspaceRecord["menus"][number];
type ApproverUserRecord = WorkspaceRecord["approverUsers"][number];

function toMenuResponse(item: MenuRecord) {
  return {
    id: item.id,
    menuCode: item.menuCode,
    menuName: item.menuName,
    route: item.route,
    activeFlag: item.activeFlag
  };
}

function toApproverUserResponse(item: ApproverUserRecord) {
  return {
    id: item.id,
    fullName: item.fullName,
    email: item.email
  };
}

function toWorkspaceResponse(workspace: WorkspaceRecord) {
  const eligibleIds = new Set(workspace.approverUsers.map((item) => item.id));

  return {
    configurations: workspace.configurations.map((item: ConfigRecord) => ({
      id: item.id,
      menu: {
        id: item.menu.id,
        menuCode: item.menu.menuCode,
        menuName: item.menu.menuName,
        route: item.menu.route,
        activeFlag: item.menu.activeFlag
      },
      approvers: item.approvers.map((assignment) => ({
        id: assignment.approverUser.id,
        fullName: assignment.approverUser.fullName,
        email: assignment.approverUser.email,
        eligible: eligibleIds.has(assignment.approverUser.id)
      })),
      activeFlag: item.activeFlag,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy
    })),
    menus: workspace.menus.map(toMenuResponse),
    approverUsers: workspace.approverUsers.map(toApproverUserResponse)
  };
}

export async function getApprovalWorkspace() {
  return toWorkspaceResponse(await loadApprovalWorkspaceRecords());
}

function ensureNoDuplicates(values: string[], message: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new HttpError(400, message);
    seen.add(value);
  }
}

export async function executeApprovalWorkspace(input: ApprovalWorkspaceExecuteInput, userId: string) {
  const workspace = await loadApprovalWorkspaceRecords();
  const existingById = new Map(workspace.configurations.map((item) => [item.id, item]));
  const existingByMenuId = new Map(workspace.configurations.map((item) => [item.menuId, item]));
  const supportedMenuById = new Map(workspace.menus.map((item) => [item.id, item]));
  const eligibleApproverIds = new Set(workspace.approverUsers.map((item) => item.id));

  ensureNoDuplicates(input.creates.map((item) => item.clientId), "Draft Approval Configuration dikirim lebih dari satu kali");
  ensureNoDuplicates(input.creates.map((item) => item.menuId), "Process/Menu tidak boleh memiliki lebih dari satu Approval Configuration");
  ensureNoDuplicates(input.updates.map((item) => item.id), "Approval Configuration yang sama dikirim lebih dari satu kali");

  const createdMenuIds = new Set<string>();
  for (const create of input.creates) {
    const menu = supportedMenuById.get(create.menuId);
    if (!menu || menu.menuCode !== SUPPORTED_APPROVAL_MENU_CODE || menu.menuType !== "PAGE") {
      throw new HttpError(400, "V1 hanya mendukung process Statement Upload");
    }
    if (!menu.activeFlag) {
      throw new HttpError(409, `Menu ${menu.menuName} sedang Inactive dan tidak dapat dikonfigurasi untuk approval`);
    }
    if (existingByMenuId.has(create.menuId) || createdMenuIds.has(create.menuId)) {
      throw new HttpError(409, `Approval Configuration untuk ${menu.menuName} sudah ada`);
    }
    createdMenuIds.add(create.menuId);

    ensureNoDuplicates(create.approverUserIds, `Approver untuk ${menu.menuName} tidak boleh duplikat`);
    for (const approverUserId of create.approverUserIds) {
      if (!eligibleApproverIds.has(approverUserId)) {
        throw new HttpError(400, "Approver baru harus ACTIVE dan memiliki akses APPROVAL_SIGN");
      }
    }
  }

  for (const update of input.updates) {
    const existing = existingById.get(update.id);
    if (!existing) throw new HttpError(404, "Salah satu Approval Configuration yang diubah tidak ditemukan");

    ensureNoDuplicates(update.input.approverUserIds, `Approver untuk ${existing.menu.menuName} tidak boleh duplikat`);

    const existingApproverIds = new Set(existing.approvers.map((item) => item.approverUserId));
    const newlyAddedIds = update.input.approverUserIds.filter((id) => !existingApproverIds.has(id));
    for (const approverUserId of newlyAddedIds) {
      if (!eligibleApproverIds.has(approverUserId)) {
        throw new HttpError(400, "Approver baru harus ACTIVE dan memiliki akses APPROVAL_SIGN");
      }
    }

    if (update.input.activeFlag) {
      const activeEligibleCount = update.input.approverUserIds.filter((id) => eligibleApproverIds.has(id)).length;
      if (activeEligibleCount === 0) {
        throw new HttpError(409, `${existing.menu.menuName} membutuhkan minimal satu approver ACTIVE yang memiliki akses APPROVAL_SIGN`);
      }
    }
  }

  if (input.creates.length === 0 && input.updates.length === 0) {
    return {
      changedCount: 0,
      ...toWorkspaceResponse(workspace)
    };
  }

  const result = await applyApprovalWorkspaceAtomic({
    creates: input.creates,
    updates: input.updates,
    userId
  });

  return {
    changedCount: input.creates.length + input.updates.length,
    ...toWorkspaceResponse(result)
  };
}
