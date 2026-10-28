import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const electron = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const children = [];
let stopping = false;

function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env }
  });
  children.push(child);
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 1); });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else child.kill("SIGTERM");
  }
  process.exitCode = code;
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
launch(npm, ["run", "dev", "-w", "backend"], { FRONTEND_ORIGIN: "http://127.0.0.1:3000" });
launch(npm, ["run", "dev", "-w", "frontend"], { NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000/api" });
launch(electron, ["."], { ARYA_DESKTOP_DEV: "1" });
