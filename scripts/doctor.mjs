import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import net from "node:net";
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

async function checkPort(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve({ ok: true, detail: "in use" });
    });
    socket.once("error", () => {
      resolve({ ok: true, detail: "free" });
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve({ ok: true, detail: "timeout" });
    });
  });
}

const checks = [
  ["node", await checkCommand("node")],
  ["npm", await checkCommand("npm")],
  ["python3", await checkCommand("python3")],
  ["codex", await checkCommand("codex")],
  ["codex login status", await checkCommand("codex", ["login", "status"])],
  ["/projects", await checkPath("/projects")],
  ["port 4180", await checkPort(4180)]
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
