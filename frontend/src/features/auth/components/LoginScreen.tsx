"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setSession } from "@/lib/api";
import { getDefaultNavigationPath } from "@/config/navigation";
import { login } from "../api/auth.api";
import { AryaBrand } from "./AryaBrand";
import { LoginForm } from "./LoginForm";
import { LoginHero } from "./LoginHero";
import styles from "../styles/login.module.css";

export function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(values: { email: string; password: string; remember: boolean }) {
    setLoading(true);
    setError("");

    try {
      const payload = await login({ email: values.email, password: values.password });
      setSession(payload.token, payload.user, values.remember);
      router.replace(getDefaultNavigationPath(payload.user.menuCodes ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <section className={styles.authPanel} aria-labelledby="login-title">
          <div className={styles.authInner}>
            <AryaBrand />

            <div className={styles.heading}>
              <h1 id="login-title">Welcome Back</h1>
              <p>Sign in to continue to your dashboard</p>
            </div>

            <LoginForm loading={loading} error={error} onSubmit={handleSubmit} />

            <footer className={styles.footer}>
              <p>© 2026 Yayasan Arya Tarray Nusantara</p>
              <span>All rights reserved.</span>
            </footer>
          </div>
        </section>

        <LoginHero />
      </div>
    </main>
  );
}
