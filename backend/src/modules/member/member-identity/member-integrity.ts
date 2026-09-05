export type IntegrityCheck = { name: string; violationCount: number; examples: string[]; note?: string };

export function parseVerifyOptions(args: string[]) {
  let exampleLimit = 5;
  for (const arg of args) {
    if (arg === "--help") {
      if (args.length > 1) throw new Error("--help cannot be combined with other options");
      return { help: true, exampleLimit };
    }
    if (!arg.startsWith("--limit=")) throw new Error(`Unknown option: ${arg}`);
    const value = Number(arg.slice(8));
    if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("--limit must be an integer from 1 to 50");
    exampleLimit = value;
  }
  return { help: false, exampleLimit };
}

export function summarizeIntegrityChecks(checks: IntegrityCheck[]) {
  const failedChecks = checks.filter(check => check.violationCount > 0).length;
  return { status: failedChecks ? "FAIL" as const : "PASS" as const, totalChecks: checks.length, failedChecks,
    totalViolations: checks.reduce((total, check) => total + check.violationCount, 0) };
}
