import { apiFetch } from "@/lib/api";
import type {
  ApprovalApproverUser,
  ApprovalAssignedApprover,
  ApprovalAuditUser,
  ApprovalConfiguration,
  ApprovalMenuOption,
  ApprovalWorkspace,
  ApprovalWorkspaceExecutePayload
} from "../types";

type ApiMenu = {
  id: string;
  menuCode: string;
  menuName: string;
  route?: string | null;
  activeFlag: boolean;
};

type ApiApproverUser = {
  id: string;
  fullName: string;
  email: string;
};

type ApiAssignedApprover = ApiApproverUser & {
  eligible: boolean;
};

type ApiAuditUser = {
  id: string;
  fullName: string;
};

type ApiConfiguration = {
  id: string;
  menu: ApiMenu;
  approvers: ApiAssignedApprover[];
  activeFlag: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: ApiAuditUser | null;
};

type ApiWorkspace = {
  configurations: ApiConfiguration[];
  menus: ApiMenu[];
  approverUsers: ApiApproverUser[];
};

type ApiExecuteResponse = ApiWorkspace & {
  changedCount: number;
};

function mapMenu(item: ApiMenu): ApprovalMenuOption {
  return {
    id: String(item.id),
    menuCode: item.menuCode,
    menuName: item.menuName,
    route: item.route ?? null,
    activeFlag: Boolean(item.activeFlag)
  };
}

function mapApproverUser(item: ApiApproverUser): ApprovalApproverUser {
  return {
    id: String(item.id),
    fullName: item.fullName,
    email: item.email
  };
}

function mapAssignedApprover(item: ApiAssignedApprover): ApprovalAssignedApprover {
  return {
    ...mapApproverUser(item),
    eligible: Boolean(item.eligible)
  };
}

function mapAuditUser(item?: ApiAuditUser | null): ApprovalAuditUser | null {
  if (!item) return null;
  return {
    id: String(item.id),
    fullName: item.fullName
  };
}

function mapConfiguration(item: ApiConfiguration): ApprovalConfiguration {
  return {
    id: String(item.id),
    menu: mapMenu(item.menu),
    approvers: item.approvers.map(mapAssignedApprover),
    activeFlag: Boolean(item.activeFlag),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: mapAuditUser(item.updatedBy)
  };
}

function mapWorkspace(value: ApiWorkspace): ApprovalWorkspace {
  return {
    configurations: value.configurations.map(mapConfiguration),
    menus: value.menus.map(mapMenu),
    approverUsers: value.approverUsers.map(mapApproverUser)
  };
}

export async function getApprovalWorkspace() {
  return mapWorkspace(await apiFetch<ApiWorkspace>("/configuration/approvals/workspace"));
}

export async function executeApprovalWorkspace(payload: ApprovalWorkspaceExecutePayload) {
  const result = await apiFetch<ApiExecuteResponse>("/configuration/approvals/workspace/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    changedCount: Number(result.changedCount ?? 0),
    ...mapWorkspace(result)
  };
}
