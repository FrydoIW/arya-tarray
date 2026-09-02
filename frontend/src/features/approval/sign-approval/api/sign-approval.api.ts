import { apiFetch } from "@/lib/api";
import type {
  SignApprovalDecisionResponse,
  SignApprovalDetail,
  SignApprovalWorkspace
} from "../types";

const SIGN_APPROVAL_BASE = "/approval/sign";

export function getSignApprovalWorkspace() {
  return apiFetch<SignApprovalWorkspace>(`${SIGN_APPROVAL_BASE}/workspace`);
}

export function getSignApprovalDetail(approvalId: string) {
  return apiFetch<SignApprovalDetail>(`${SIGN_APPROVAL_BASE}/${approvalId}`);
}

export function approveSignApproval(approvalId: string, remark?: string) {
  return apiFetch<SignApprovalDecisionResponse>(`${SIGN_APPROVAL_BASE}/${approvalId}/approve`, {
    method: "POST",
    body: JSON.stringify({ remark: remark?.trim() || undefined })
  });
}

export function rejectSignApproval(approvalId: string, remark: string) {
  return apiFetch<SignApprovalDecisionResponse>(`${SIGN_APPROVAL_BASE}/${approvalId}/reject`, {
    method: "POST",
    body: JSON.stringify({ remark: remark.trim() })
  });
}
