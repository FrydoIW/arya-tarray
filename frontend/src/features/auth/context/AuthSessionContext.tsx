"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../types";

const AuthSessionContext = createContext<User | null>(null);

export function AuthSessionProvider({ user, children }: { user: User; children: ReactNode }) {
  return <AuthSessionContext.Provider value={user}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const user = useContext(AuthSessionContext);
  if (!user) throw new Error("useAuthSession must be used inside AuthSessionProvider");
  return user;
}
