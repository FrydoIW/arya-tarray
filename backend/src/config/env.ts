import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function nonNegativeInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function positiveInteger(name: string, fallback: number) {
  const value = nonNegativeInteger(name, fallback);
  if (value === 0) throw new Error(`${name} must be greater than zero`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  loginRateLimitMaxFailures: positiveInteger("LOGIN_RATE_LIMIT_MAX_FAILURES", 8),
  loginRateLimitWindowMs: positiveInteger("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  loginRateLimitCooldownMs: positiveInteger("LOGIN_RATE_LIMIT_COOLDOWN_MS", 15 * 60 * 1000),
  trustedProxyHops: nonNegativeInteger("TRUSTED_PROXY_HOPS", 0)
};
