import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(root, ".desktop-build");
const runtime = path.join(buildRoot, "runtime");
const release = path.join(buildRoot, "release");
const marker = path.join(buildRoot, ".arya-desktop-build");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed (exit ${code})`)));
  });
}

async function copyDirectory(source, destination) {
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

async function prepareBuildRoot() {
  const exists = await fs.stat(buildRoot).then(() => true, () => false);
  if (exists && !(await fs.stat(marker).then(() => true, () => false))) {
    throw new Error(`Refusing to clear unowned build directory: ${buildRoot}`);
  }
  await fs.mkdir(buildRoot, { recursive: true });
  await fs.writeFile(marker, "Arya Tarray generated desktop build artifacts.\n", { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  for (const directory of [runtime, release]) {
    if (path.dirname(directory) !== buildRoot) throw new Error("Unsafe build path");
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function stageRuntime() {
  const frontendRoot = path.join(root, "frontend");
  const standalone = path.join(frontendRoot, ".next", "standalone");
  const frontendServer = await fs.stat(path.join(standalone, "frontend", "server.js")).then(
    () => path.join(standalone, "frontend"),
    () => standalone
  );
  if (!(await fs.stat(path.join(frontendServer, "server.js")).then(() => true, () => false))) {
    throw new Error("Next.js standalone server was not produced by frontend build.");
  }
  await copyDirectory(standalone, path.join(runtime, "frontend"));
  const stagedFrontend = path.join(runtime, "frontend", path.relative(standalone, frontendServer));
  await copyDirectory(path.join(frontendRoot, ".next", "static"), path.join(stagedFrontend, ".next", "static"));
  await copyDirectory(path.join(frontendRoot, "public"), path.join(stagedFrontend, "public"));

  const stagedBackend = path.join(runtime, "backend");
  await fs.mkdir(stagedBackend, { recursive: true });
  const backendPackage = JSON.parse(await fs.readFile(path.join(root, "backend", "package.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
  const dependencies = Object.fromEntries(Object.entries(backendPackage.dependencies).map(([name, range]) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    return [name, version ?? range];
  }));
  await fs.writeFile(path.join(stagedBackend, "package.json"), JSON.stringify({
    name: "arya-tarray-desktop-backend", private: true, type: "module", dependencies
  }, null, 2));
  await copyDirectory(path.join(root, "backend", "dist", "src"), path.join(stagedBackend, "dist", "src"));
  await run(npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", stagedBackend]);
  const generatedClient = path.join(root, "node_modules", ".prisma", "client");
  if (!(await fs.stat(generatedClient).then(() => true, () => false))) {
    throw new Error("Prisma client is missing. Run npm run db:generate -w backend before desktop:build.");
  }
  await copyDirectory(generatedClient, path.join(stagedBackend, "node_modules", ".prisma", "client"));
  await fs.writeFile(path.join(runtime, "manifest.json"), JSON.stringify({ frontendServer: path.relative(path.join(runtime, "frontend"), stagedFrontend).replaceAll("\\", "/") }, null, 2));
}

async function assertNoEnvironmentFiles(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in desktop runtime: ${absolute}`);
    if (entry.isDirectory()) await assertNoEnvironmentFiles(absolute);
    else if (entry.isFile() && /^\.env(?:\.|$)/i.test(entry.name)) {
      throw new Error(`Refusing to package an environment file: ${absolute}`);
    }
  }
}

function windowsDownloads() {
  if (process.platform !== "win32") throw new Error("desktop:build currently supports Windows only.");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'",
    "$name = '{374DE290-123F-4565-9164-39C4925E467B}'",
    "try { $value = Get-ItemPropertyValue -Path $key -Name $name } catch { $value = Join-Path $env:USERPROFILE 'Downloads' }",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "[Environment]::ExpandEnvironmentVariables($value)"
  ].join("; ");
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(path.resolve(output.trim())) : reject(new Error(`Downloads lookup failed: ${errors}`)));
  });
}

async function publishInstaller(version) {
  const downloads = await windowsDownloads();
  if (!(await fs.stat(downloads).then(stat => stat.isDirectory(), () => false))) {
    throw new Error(`Windows Downloads folder does not exist: ${downloads}`);
  }
  const expected = `AryaTarray-Setup-${version}.exe`;
  const source = path.join(release, expected);
  if (!(await fs.stat(source).then(stat => stat.isFile() && stat.size > 0, () => false))) {
    throw new Error(`Final installer was not produced: ${source}`);
  }
  for (let index = 1; index < 10000; index++) {
    const name = index === 1 ? expected : `AryaTarray-Setup-${version}-${index}.exe`;
    const destination = path.join(downloads, name);
    try {
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
      console.log(`Installer ready: ${destination}`);
      return destination;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not find an unused versioned installer filename in Downloads.");
}

async function main() {
  if (process.platform !== "win32") throw new Error("desktop:build currently supports Windows only.");
  await prepareBuildRoot();
  await run(npm, ["run", "build", "-w", "backend"]);
  await run(npm, ["run", "build", "-w", "frontend"], {
    env: { ...process.env, NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000/api" }
  });
  await stageRuntime();
  await assertNoEnvironmentFiles(runtime);
  await run(path.join(root, "node_modules", ".bin", "electron-builder.cmd"), ["--win", "nsis"]);
  const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  await publishInstaller(version);
  await fs.rm(runtime, { recursive: true, force: true });
  await fs.rm(release, { recursive: true, force: true });
  console.log("Temporary desktop staging and installer build files removed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
