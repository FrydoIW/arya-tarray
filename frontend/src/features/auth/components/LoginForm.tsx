"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import styles from "../styles/login.module.css";

type LoginFormProps = {
  loading: boolean;
  error: string;
  onSubmit: (values: { email: string; password: string; remember: boolean }) => Promise<void>;
};

function LotusIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4.5c3.2 3.2 3.6 6.2 0 9.4-3.6-3.2-3.2-6.2 0-9.4Z" />
        <path d="M7.2 9.2c4.7.4 6.8 2.8 6.8 7.3-4.6-.3-6.8-2.8-6.8-7.3Z" />
        <path d="M20.8 9.2c-4.7.4-6.8 2.8-6.8 7.3 4.6-.3 6.8-2.8 6.8-7.3Z" />
        <path d="M5.2 16.8c4.6-.7 7.5.9 8.8 5.2-4.7.7-7.5-.9-8.8-5.2Z" />
        <path d="M22.8 16.8c-4.6-.7-7.5.9-8.8 5.2 4.7.7 7.5-.9 8.8-5.2Z" />
      </g>
    </svg>
  );
}

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
        <span className={styles.srOnly}>Email address</span>
        <div className={styles.inputShell}>
          <Mail size={21} aria-hidden="true" />
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
            required
          />
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.srOnly}>Password</span>
        <div className={styles.inputShell}>
          <LockKeyhole size={21} aria-hidden="true" />
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          <button
            className={styles.eyeButton}
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
          >
            {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
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
        {!loading ? <ArrowRight size={20} aria-hidden="true" /> : null}
      </button>

      <div className={styles.formBlessing} aria-hidden="true">
        <span />
        <LotusIcon />
        <span />
      </div>

      <p className={styles.protectedText}>Protected by Dharma. Secured and at Care.</p>
    </form>
  );
}
