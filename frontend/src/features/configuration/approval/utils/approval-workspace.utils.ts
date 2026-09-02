import type {
  ApprovalApproverUser,
  ApprovalAssignedApprover,
  ApprovalConfiguration,
  ApprovalStatusFilter,
  ApprovalWorkspaceExecutePayload
} from "../types";

export const SUPPORTED_APPROVAL_MENU_CODE = "RECON_STATEMENT_UPLOAD";

function normalizedIds(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function configurationApproverIds(item: ApprovalConfiguration) {
  return item.approvers.map((approver) => approver.id);
}

function sameIds(a: string[], b: string[]) {
  const left = normalizedIds(a);
  const right = normalizedIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameConfigurationUpdate(a: ApprovalConfiguration, b: ApprovalConfiguration) {
  return a.activeFlag === b.activeFlag
    && sameIds(configurationApproverIds(a), configurationApproverIds(b));
}

export function configurationsAreDirty(serverRows: ApprovalConfiguration[], workingRows: ApprovalConfiguration[]) {
  if (workingRows.some((item) => item.isDraft)) return true;
  if (workingRows.length !== serverRows.length) return true;
  const serverMap = new Map(serverRows.map((item) => [item.id, item]));
  return workingRows.some((item) => {
    const original = serverMap.get(item.id);
    return !original || !sameConfigurationUpdate(item, original);
  });
}

export function filterConfigurations(
  rows: ApprovalConfiguration[],
  search: string,
  statusFilter: ApprovalStatusFilter
) {
  const keyword = search.trim().toLowerCase();

  return rows.filter((item) => {
    const statusMatches = statusFilter === "ALL"
      || (statusFilter === "ACTIVE" && item.activeFlag)
      || (statusFilter === "INACTIVE" && !item.activeFlag);
    if (!statusMatches) return false;
    if (!keyword) return true;

    return [
      item.menu.menuCode,
      item.menu.menuName,
      item.updatedBy?.fullName ?? "",
      ...item.approvers.flatMap((approver) => [approver.fullName, approver.email])
    ].some((value) => value.toLowerCase().includes(keyword));
  });
}

export function summarizeConfigurations(rows: ApprovalConfiguration[]) {
  return {
    total: rows.length,
    active: rows.filter((item) => item.activeFlag).length,
    approvers: rows.reduce((total, item) => total + item.approvers.length, 0)
  };
}

export function resolveApprovers(
  ids: string[],
  eligibleUsers: ApprovalApproverUser[],
  current: ApprovalAssignedApprover[] = []
) {
  const eligibleById = new Map(eligibleUsers.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));

  return normalizedIds(ids).map((id) => {
    const eligible = eligibleById.get(id);
    if (eligible) return { ...eligible, eligible: true };
    const existing = currentById.get(id);
    if (existing) return { ...existing, eligible: false };
    return null;
  }).filter((item): item is ApprovalAssignedApprover => item !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function validateApprovalWorkspace(params: {
  serverRows: ApprovalConfiguration[];
  workingRows: ApprovalConfiguration[];
  eligibleUsers: ApprovalApproverUser[];
}) {
  const { serverRows, workingRows, eligibleUsers } = params;
  const menuIds = new Set<string>();
  const eligibleIds = new Set(eligibleUsers.map((item) => item.id));
  const serverMap = new Map(serverRows.map((item) => [item.id, item]));

  for (const row of workingRows) {
    if (!row.menu.id) return "Process/Menu wajib dipilih.";
    if (row.menu.menuCode !== SUPPORTED_APPROVAL_MENU_CODE) return "V1 hanya mendukung Statement Upload.";
    if (menuIds.has(row.menu.id)) return `Approval Configuration untuk ${row.menu.menuName} muncul lebih dari satu kali.`;
    menuIds.add(row.menu.id);

    const approverIds = configurationApproverIds(row);
    if (approverIds.length === 0) return `Minimal satu approver wajib dipilih untuk ${row.menu.menuName}.`;
    if (new Set(approverIds).size !== approverIds.length) return `Approver untuk ${row.menu.menuName} tidak boleh duplikat.`;

    if (row.isDraft) {
      if (approverIds.some((id) => !eligibleIds.has(id))) {
        return "Approver baru harus Active dan memiliki akses Sign Approval.";
      }
    } else {
      const originalIds = new Set(configurationApproverIds(serverMap.get(row.id) ?? row));
      const invalidNewApprover = approverIds.find((id) => !originalIds.has(id) && !eligibleIds.has(id));
      if (invalidNewApprover) return "Approver baru harus Active dan memiliki akses Sign Approval.";
    }

    if (row.activeFlag && !approverIds.some((id) => eligibleIds.has(id))) {
      return `${row.menu.menuName} membutuhkan minimal satu approver Active yang memiliki akses Sign Approval.`;
    }
  }

  return "";
}

export function buildApprovalWorkspacePayload(params: {
  serverRows: ApprovalConfiguration[];
  workingRows: ApprovalConfiguration[];
}): ApprovalWorkspaceExecutePayload {
  const { serverRows, workingRows } = params;
  const serverMap = new Map(serverRows.map((item) => [item.id, item]));
  const creates: ApprovalWorkspaceExecutePayload["creates"] = [];
  const updates: ApprovalWorkspaceExecutePayload["updates"] = [];

  for (const item of workingRows) {
    const approverUserIds = normalizedIds(configurationApproverIds(item));

    if (item.isDraft) {
      creates.push({
        clientId: item.id,
        menuId: item.menu.id,
        approverUserIds,
        activeFlag: item.activeFlag
      });
      continue;
    }

    const original = serverMap.get(item.id);
    if (!original || !sameConfigurationUpdate(item, original)) {
      updates.push({
        id: item.id,
        input: {
          approverUserIds,
          activeFlag: item.activeFlag
        }
      });
    }
  }

  return { creates, updates };
}
