const { app, BrowserWindow, dialog } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_URL = "http://127.0.0.1:3000";
const BACKEND_URL = "http://127.0.0.1:4000/health";
const children = [];
let quitting = false;

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    child.kill("SIGTERM");
  }
}

function startNode(entry, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", ...extraEnv }
  });
  child.stdout.on("data", chunk => process.stdout.write(chunk));
  child.stderr.on("data", chunk => process.stderr.write(chunk));
  child.on("error", error => console.error(error));
  children.push(child);
  return child;
}

async function waitFor(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Local service stopped (exit ${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(`Local service did not become available: ${url}`);
}

async function startProductionServices() {
  const configPath = process.env.ARYA_TARRAY_ENV_FILE || path.join(app.getPath("userData"), "backend.env");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Database configuration is missing. Create this file with DATABASE_URL and JWT_SECRET:\n${configPath}`);
  }
  const runtime = path.join(process.resourcesPath, "runtime");
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
  const backend = path.join(runtime, "backend");
  const frontend = path.join(runtime, "frontend", manifest.frontendServer);
  const backendChild = startNode(path.join(backend, "dist", "src", "server.js"), backend, {
    DOTENV_CONFIG_PATH: configPath,
    PORT: "4000",
    FRONTEND_ORIGIN: FRONTEND_URL
  });
  await waitFor(BACKEND_URL, backendChild);
  const frontendChild = startNode(path.join(frontend, "server.js"), frontend, {
    PORT: "3000",
    HOSTNAME: "127.0.0.1"
  });
  await waitFor(FRONTEND_URL, frontendChild);
}

function openWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Arya Tarray",
    backgroundColor: "#faf7f0",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`${FRONTEND_URL}/`) && target !== FRONTEND_URL) event.preventDefault();
  });
  void window.loadURL(FRONTEND_URL);
}

app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  for (const child of children) stopChild(child);
});
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  try {
    if (process.env.ARYA_DESKTOP_DEV === "1") {
      await waitFor(BACKEND_URL);
      await waitFor(FRONTEND_URL);
    } else {
      await startProductionServices();
    }
    openWindow();
  } catch (error) {
    dialog.showErrorBox("Arya Tarray could not start", error.message);
    app.quit();
  }
});
