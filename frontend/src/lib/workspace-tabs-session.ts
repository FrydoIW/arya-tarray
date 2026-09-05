export const WORKSPACE_TABS_KEY = "arya_workspace_tabs";

export function clearWorkspaceTabsSession() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(WORKSPACE_TABS_KEY);
  }
}
