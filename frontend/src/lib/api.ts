import { clearWorkspaceTabsSession } from "./workspace-tabs-session";
import { clearWorkspaceCache } from "./workspace-cache";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

const TOKEN_KEY = "arya_token";
const USER_KEY = "arya_user";

function storages() {
  if (typeof window === "undefined") return [];
  return [window.localStorage, window.sessionStorage];
}

export function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY) ?? window.sessionStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: unknown, remember = true) {
  if (typeof window === "undefined") return;

  clearWorkspaceCache();
  clearWorkspaceTabsSession();

  const target = remember ? window.localStorage : window.sessionStorage;
  const other = remember ? window.sessionStorage : window.localStorage;

  other.removeItem(TOKEN_KEY);
  other.removeItem(USER_KEY);
  target.setItem(TOKEN_KEY, token);
  target.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  clearWorkspaceCache();
  for (const storage of storages()) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
  clearWorkspaceTabsSession();
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);

  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      clearSession();
      window.location.href = "/login";
    }

    throw new Error(payload.message ?? "Request failed");
  }

  return payload as T;
}


export async function apiFetchBlob(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && typeof window !== "undefined") {
      clearSession();
      window.location.href = "/login";
    }
    throw new Error(payload.message ?? "Request failed");
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileNameMatch = /filename="?([^";]+)"?/i.exec(disposition);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? "report.pdf"
  };
}
