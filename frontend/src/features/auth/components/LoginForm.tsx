"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import styles from "../styles/login.module.css";

type LoginFormProps = {
  loading: boolean;
  error: string;
  onSubmit: (values: { email: string; password: string; remember: boolean }) => Promise<void>;
};

export function LoginForm({ loading, error, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    await onSubmit({ email, password, remember });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Email</span>
        <div className={styles.inputShell}>
          <Mail size={19} aria-hidden="true" />
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@aryatarray.local"
            autoComplete="email"
            required
          />
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Password</span>
        <div className={styles.inputShell}>
          <LockKeyhole size={19} aria-hidden="true" />
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />
          <button
            className={styles.eyeButton}
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
          >
            {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>
      </label>

      <div className={styles.optionsRow}>
        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>Remember me</span>
        </label>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      <button className={styles.submitButton} type="submit" disabled={loading}>
        <span>{loading ? "Signing in…" : "Sign In"}</span>
        {!loading ? <ArrowRight size={18} aria-hidden="true" /> : null}
      </button>

      <p className={styles.protectedText}>Protected access for authorized internal users only.</p>
    </form>
  );
}
