import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Source handoff is an allowlist, not a ZIP of the working directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (path.resolve(process.cwd()) !== root) {
  throw new Error(`Run this script from the repository root: ${root}`);
}

const rootFiles = new Set([
  ".gitignore", "AGENTS.md", "README.md", "ARCHITECTURE.md", "DATABASE.md",
  "TESTING.md", "SECURITY.md", "DEPLOYMENT.md", "BACKUP_RESTORE.md",
  "SOURCE_HANDOFF.md", "VALIDATION.md", "package.json", "package-lock.json",
  "backend/.env.example", "backend/API.md", "backend/package.json",
  "backend/tsconfig.json", "backend/prisma/schema.prisma", "backend/prisma/seed.ts",
  "backend/prisma/README.md", "backend/prisma/bootstrap-admin.sql", "frontend/.env.example",
  "frontend/next-env.d.ts", "frontend/next.config.ts", "frontend/package.json",
  "frontend/tsconfig.json", "scripts/package-source.mjs"
]);
const approvedDirs = [
  ".github/workflows/", "backend/src/", "backend/tests/", "backend/scripts/",
  "frontend/src/", "frontend/public/", "docs/"
];
const forbiddenSegments = new Set([
  ".git", ".agents", ".playwright-mcp", ".idea", ".vscode", "node_modules",
  ".next", "dist", "build", "coverage", "uploads", "backups", "tmp", "temp",
  "exports", "release"
]);

function normalize(candidate) {
  const relative = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || relative.includes("\0") ||
      relative.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe repository path: ${candidate}`);
  }
  return relative;
}

function forbidden(relative) {
  const parts = relative.split("/");
  const name = parts.at(-1);
  if (parts.some(part => forbiddenSegments.has(part.toLowerCase()))) return true;
  if (relative.startsWith("docs/design/")) return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  if (/\.(?:log|tsbuildinfo|dump|backup|zip|tar|tgz|7z|sql\.gz)$/i.test(name)) return true;
  if (/(?:^|[-_.])(?:tmp|temp|export)(?:[-_.]|$)/i.test(name)) return true;
  return false;
}

function approved(relative) {
  return rootFiles.has(relative) || approvedDirs.some(prefix => relative.startsWith(prefix));
}

function run(program, args, options = {}) {
  return spawnSync(program, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
}

async function walkApprovedDirectory(relativeDir, output) {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = normalize(`${relativeDir}/${entry.name}`);
    if (forbidden(relative) || !approved(relative)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink requires manual review: ${relative}`);
    if (entry.isDirectory()) await walkApprovedDirectory(relative, output);
    else if (entry.isFile()) output.add(relative);
  }
}

async function repositoryCandidates() {
  const result = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "buffer" });
  if (!result.error && result.status === 0) {
    const listed = [...new Set(result.stdout.toString("utf8").split("\0").filter(Boolean).map(normalize))];
    const existing = [];
    for (const relative of listed) {
      try {
        const stat = await fs.lstat(path.join(root, relative));
        if (stat.isFile()) existing.push(relative);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return existing.sort();
  }
  // A source export may lack .git. Walk only the named source roots, never the checkout at large.
  const output = new Set();
  for (const relative of rootFiles) {
    try { if ((await fs.lstat(path.join(root, relative))).isFile()) output.add(relative); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const prefix of approvedDirs) {
    try { await walkApprovedDirectory(prefix.slice(0, -1), output); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return [...output].sort();
}

function assertRequired(manifest) {
  const files = new Set(manifest);
  const required = [
    "README.md", "ARCHITECTURE.md", "DATABASE.md", "TESTING.md", "SECURITY.md",
    "DEPLOYMENT.md", "BACKUP_RESTORE.md", "SOURCE_HANDOFF.md", "package.json",
    "package-lock.json", ".github/workflows/ci.yml", "backend/package.json",
    "frontend/package.json", "backend/.env.example", "frontend/.env.example",
    "backend/prisma/schema.prisma", "backend/prisma/seed.ts",
    "backend/prisma/README.md", "backend/prisma/bootstrap-admin.sql",
    "scripts/package-source.mjs"
  ];
  for (const relative of required) {
    if (!files.has(relative)) throw new Error(`Required source is missing from staging: ${relative}`);
  }
  for (const prefix of ["frontend/src/", "frontend/public/", "backend/src/", "backend/tests/"]) {
    if (!manifest.some(relative => relative.startsWith(prefix))) throw new Error(`Required source directory is empty: ${prefix}`);
  }
}

async function stagedManifest(stageRoot) {
  const output = [];
  async function visit(dir, prefix = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = normalize(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in staging: ${relative}`);
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), relative);
      else if (entry.isFile()) output.push(relative);
      else throw new Error(`Unsupported staged item: ${relative}`);
    }
  }
  await visit(stageRoot);
  return output.sort();
}

async function scanStaging(stageRoot, manifest) {
  const credentialMarker = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}/;
  for (const relative of manifest) {
    if (!approved(relative) || forbidden(relative)) throw new Error(`Forbidden staged path: ${relative}`);
    const absolute = path.join(stageRoot, relative);
    const stat = await fs.stat(absolute);
    if (stat.size > 2 * 1024 * 1024) continue; // Binary assets/fixtures require human review.
    if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|xlsx|pdf)$/i.test(relative)) continue;
    const contents = await fs.readFile(absolute, "utf8");
    if (credentialMarker.test(contents)) throw new Error(`Potential credential marker in staged file: ${relative}`);
  }
  assertRequired(manifest);
}

function powershell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
}

function psLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

function createZip(tempRoot, stageRoot, zipPath, expected) {
  let listing;
  if (process.platform === "win32") {
    const create = powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${psLiteral(stageRoot)}, ${psLiteral(zipPath)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`);
    if (create.error?.code === "ENOENT") return false;
    if (create.status !== 0) throw new Error(`ZIP creation failed: ${create.stderr || create.stdout}`);
    const list = powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead(${psLiteral(zipPath)}); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`);
    if (list.status !== 0) throw new Error(`ZIP listing failed: ${list.stderr || list.stdout}`);
    listing = list.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } else {
    const create = run("zip", ["-q", "-r", zipPath, path.basename(stageRoot)], { cwd: tempRoot });
    if (create.error?.code === "ENOENT") return false;
    if (create.status !== 0) throw new Error(`ZIP creation failed: ${create.stderr || create.stdout}`);
    const list = run("unzip", ["-Z", "-1", zipPath]);
    if (list.error?.code === "ENOENT") throw new Error("ZIP created, but unzip is unavailable for manifest verification.");
    if (list.status !== 0) throw new Error(`ZIP listing failed: ${list.stderr || list.stdout}`);
    listing = list.stdout.split(/\r?\n/).filter(Boolean);
  }
  const archiveFiles = listing.filter(name => !name.endsWith("/"))
    .map(name => name.replaceAll("\\", "/").replace(/^arya-tarray-source\//, ""))
    .sort();
  if (archiveFiles.length !== expected.length || archiveFiles.some((name, index) => name !== expected[index])) {
    throw new Error("ZIP contents do not exactly match the verified staging manifest.");
  }
  return true;
}

const candidates = await repositoryCandidates();
const selected = candidates.filter(relative => approved(relative) && !forbidden(relative));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arya-tarray-handoff-"));
const stageRoot = path.join(tempRoot, "arya-tarray-source");
await fs.mkdir(stageRoot);

for (const relative of selected) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (!stat.isFile()) throw new Error(`Only regular source files may be packaged: ${relative}`);
  const destination = path.resolve(stageRoot, relative);
  if (!destination.startsWith(stageRoot + path.sep)) throw new Error(`Destination escaped staging: ${relative}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

const manifest = await stagedManifest(stageRoot);
await scanStaging(stageRoot, manifest);
console.log(`Verified staging directory: ${stageRoot}`);
const worktree = run("git", ["status", "--porcelain"]);
if (!worktree.error && worktree.status === 0 && worktree.stdout.trim()) {
  console.log("WARNING: The package includes non-ignored working-tree changes; the Git SHA alone does not identify these file contents.");
}
console.log(`Complete source manifest (${manifest.length} files):`);
for (const relative of manifest) console.log(relative);

const sha = run("git", ["rev-parse", "--short", "HEAD"]);
const suffix = !sha.error && sha.status === 0 && /^[0-9a-f]+$/i.test(sha.stdout.trim()) ? `-${sha.stdout.trim()}` : "";
const zipPath = path.join(tempRoot, `arya-tarray-source${suffix}.zip`);
if (createZip(tempRoot, stageRoot, zipPath, manifest)) {
  console.log(`Verified source ZIP: ${zipPath}`);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(zipPath)) digest.update(chunk);
  console.log(`Source ZIP SHA-256: ${digest.digest("hex")}`);
} else {
  console.log("No verified portable ZIP archiver was available; staging remains ready for manual archiving.");
  console.log(process.platform === "win32"
    ? `From PowerShell, archive ${stageRoot} to ${zipPath} and compare its file listing with the manifest above.`
    : `From ${tempRoot}, run: zip -r ${zipPath} arya-tarray-source; then compare its listing with the manifest above.`);
}
