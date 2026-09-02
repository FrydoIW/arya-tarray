"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDefaultNavigationPath } from "@/config/navigation";
import { getToken } from "@/lib/api";
import { ScreenLoader } from "@/components/layout/ScreenLoader";
import { getCurrentUser } from "../api/auth.api";

export function LandingRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    getCurrentUser()
      .then((user) => router.replace(getDefaultNavigationPath(user.menuCodes ?? [])))
      .catch(() => router.replace("/login"));
  }, [router]);

  return <ScreenLoader />;
}
