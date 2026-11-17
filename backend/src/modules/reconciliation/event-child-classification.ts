import { HttpError } from "../../lib/http.js";

/**
 * Canonical Event Code Child classification rules.
 *
 * A Child is a classification detail attached to the transaction's final
 * parent Event Code. Resolution states:
 * - NO_CHILDREN: the parent never had children; legacy parent-only behavior.
 * - AUTO_SELECT: exactly one active child; the system auto-selects it.
 * - MANUAL_REQUIRED: more than one active child; the operator must choose.
 * - ALL_INACTIVE: children exist but none are active; final processing is blocked.
 */

export type ChildParent = { id: string; eventType: string; activeFlag: boolean };
export type ChildOption = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  activeFlag: boolean;
};

export type ChildResolutionState = "NO_CHILDREN" | "AUTO_SELECT" | "MANUAL_REQUIRED" | "ALL_INACTIVE";

export function resolveChildResolutionState(parent: ChildParent | null, children: ChildOption[]): ChildResolutionState {
  if (!parent) return "NO_CHILDREN";
  if (children.length === 0) return "NO_CHILDREN";
  const active = children.filter((child) => child.activeFlag);
  if (active.length === 0) return "ALL_INACTIVE";
  if (active.length === 1) return "AUTO_SELECT";
  return "MANUAL_REQUIRED";
}

export function selectSingleEligibleChild(parent: ChildParent | null, children: ChildOption[]) {
  const state = resolveChildResolutionState(parent, children);
  if (state !== "AUTO_SELECT") return null;
  return children.filter((child) => child.activeFlag)[0].id;
}

export function childResolutionLabel(state: ChildResolutionState) {
  switch (state) {
    case "NO_CHILDREN":
      return "Parent without children";
    case "AUTO_SELECT":
      return "Single active child (auto-selected)";
    case "MANUAL_REQUIRED":
      return "Child selection required";
    case "ALL_INACTIVE":
      return "No active child available";
  }
}

export type ChildAssertInput = {
  eventCode: ChildParent | null;
  childId: string | null;
  child: ChildOption | null;
  children: ChildOption[];
  requiresClassification: boolean;
  requireComplete: boolean;
  historicalChildId?: string | null;
};

/**
 * Validates a child selection against its parent. Mirrors the Campaign rules:
 * ownership, activity, and historical exemption are the only accepted states.
 */
export function assertChildClassification(input: ChildAssertInput) {
  const { eventCode, childId, child, children, requiresClassification, requireComplete } = input;

  if (!requiresClassification || !eventCode) {
    if (childId) throw new HttpError(400, "Child is not applicable to this transaction");
    return;
  }
  if (!childId) {
    if (children.length === 0) return;
    if (requireComplete) {
      const state = resolveChildResolutionState(eventCode, children);
      if (state === "MANUAL_REQUIRED") throw new HttpError(400, "Child selection is required for this Final Event");
      if (state === "ALL_INACTIVE") throw new HttpError(400, "No active Child is available for this Final Event");
    }
    return;
  }
  if (!child || child.eventCodeId !== eventCode.id) {
    throw new HttpError(400, "Child does not belong to the selected Event Code");
  }
  if (input.historicalChildId === childId) return;
  if (!child.activeFlag) {
    throw new HttpError(400, "The selected Child is inactive");
  }
}

export type StoredChildAttentionInput = {
  requiresClassification: boolean;
  eventCodeId: string | null;
  childId: string | null;
  child: { activeFlag: boolean; eventCodeId: string } | null;
  children: ChildOption[];
};

/**
 * True when a stored transaction is not yet fit for final processing because
 * of its Child state: a selection is missing while the parent has children,
 * or the stored child is stale (missing/inactive/cross-parent). A missing
 * selection is intentionally never auto-filled at Execute, so configuration
 * changes after preview always surface as an explicit review item.
 */
export function storedChildNeedsAttention(input: StoredChildAttentionInput) {
  if (!input.requiresClassification || !input.eventCodeId) return false;
  if (input.children.length === 0) return false;
  if (!input.childId) return true;
  if (!input.child || input.child.eventCodeId !== input.eventCodeId) return true;
  return !input.child.activeFlag;
}

/** Detailed reason used by Execute to produce actionable error messages. */
export function storedChildAttentionReason(input: StoredChildAttentionInput): string | null {
  if (!input.requiresClassification || !input.eventCodeId || input.children.length === 0) return null;
  if (!input.childId) {
    const state = resolveChildResolutionState({ id: input.eventCodeId, eventType: "", activeFlag: true }, input.children);
    if (state === "ALL_INACTIVE") return "its Final Event has no active Child";
    if (state === "MANUAL_REQUIRED") return "Child selection is required for its Final Event";
    return "its Final Event now has Child configuration but the transaction has no Child selection";
  }
  if (!input.child || input.child.eventCodeId !== input.eventCodeId) {
    return "its stored Child no longer belongs to its Final Event";
  }
  if (!input.child.activeFlag) return "its stored Child is inactive";
  return null;
}
