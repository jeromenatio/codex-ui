import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function checkCommand(command, args = ["--version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { env: process.env });
    return {
      ok: true,
      detail: (stdout || stderr || "").trim() || "available"
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkPath(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return { ok: true, detail: "present" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

const checks = [
  ["node", await checkCommand("node")],
  ["npm", await checkCommand("npm")],
  ["codex", await checkCommand("codex")],
  ["codex login status", await checkCommand("codex", ["login", "status"])],
  ["/projects", await checkPath("/projects")]
];

let hasFailure = false;

for (const [label, result] of checks) {
  if (!result.ok) {
    hasFailure = true;
  }

  console.log(`${result.ok ? "OK " : "ERR"} ${label}: ${result.detail}`);
}

if (hasFailure) {
  process.exitCode = 1;
}
