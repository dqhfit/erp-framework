/* ==========================================================
   subprocess.ts — SubprocessManager: spawn/stop child process
   cho tools có runtime="spawn" (web-app + node, mcp-server stdio,
   cli demand). Cấp ephemeral port qua net.createServer().listen(0).
   Health check HTTP, log line-buffered (truncate 4KB, rate-limit).
   ========================================================== */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { toolRegistry, type ToolManifest } from "@erp-framework/core";

interface RunningProc {
  child: ChildProcess;
  port: number;
  startedAt: Date;
  toolId: string;
}

const procs = new Map<string, RunningProc>();

/** Cấp 1 cổng trống (ephemeral) bằng cách bind:0 rồi đóng. */
async function allocatePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.once("listening", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(); rej(new Error("Không lấy được cổng")); return;
      }
      const p = addr.port;
      srv.close(() => res(p));
    });
    srv.listen(0, "127.0.0.1");
  });
}

/** Poll healthPath cho tới khi 2xx hoặc hết timeout. */
async function waitHealth(
  port: number, path: string, timeoutMs = 30_000,
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${path.startsWith("/") ? path : "/" + path}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await wait(800);
  }
  return false;
}

/** Bắt đầu tool (idempotent — nếu đã chạy, trả runtimeMeta hiện tại). */
export async function startTool(manifest: ToolManifest): Promise<{ port: number; pid: number }> {
  const existing = procs.get(manifest.id);
  if (existing && existing.child.exitCode === null) {
    return { port: existing.port, pid: existing.child.pid ?? -1 };
  }
  if (!manifest.spawn) {
    throw new Error(`Tool "${manifest.id}" thiếu cấu hình spawn`);
  }
  const port = manifest.spawn.port ?? await allocatePort();
  const env = {
    ...process.env,
    ...manifest.spawn.env,
    PORT: String(port),
    // Cooperative hint cho tool tự enforce network whitelist.
    ALLOWED_HOSTS: manifest.permissions
      .filter((p) => p.startsWith("network:"))
      .map((p) => p.slice("network:".length))
      .join(","),
  };
  const child = spawn(
    manifest.spawn.command,
    manifest.spawn.args ?? [],
    {
      cwd: manifest.spawn.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    },
  );

  // Log line-buffered — truncate 4KB, log ra console (server logger sẽ catch).
  const buffer = (prefix: string) => (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const trimmed = line.length > 4096 ? line.slice(0, 4096) + "…" : line;
      console.log(`[tool:${manifest.id}] ${prefix} ${trimmed}`);
    }
  };
  child.stdout?.on("data", buffer("stdout"));
  child.stderr?.on("data", buffer("stderr"));
  child.on("exit", (code, signal) => {
    console.log(`[tool:${manifest.id}] exited code=${code} signal=${signal}`);
    procs.delete(manifest.id);
    toolRegistry.setStatus(manifest.id, "error",
      undefined,
      `Process exited code=${code}`);
  });

  procs.set(manifest.id, {
    child, port, startedAt: new Date(), toolId: manifest.id,
  });
  toolRegistry.setStatus(manifest.id, "running", {
    pid: child.pid, port, startedAt: new Date(),
  });

  const healthPath = manifest.spawn.healthPath ?? "/health";
  const healthy = await waitHealth(port, healthPath);
  if (!healthy) {
    console.warn(`[tool:${manifest.id}] health check failed (no 2xx ${healthPath})`);
    // Không kill — có thể tool không expose /health nhưng vẫn hoạt động.
  }
  return { port, pid: child.pid ?? -1 };
}

export function stopTool(toolId: string): boolean {
  const p = procs.get(toolId);
  if (!p) return false;
  p.child.kill();
  procs.delete(toolId);
  toolRegistry.setStatus(toolId, "validated");
  return true;
}

export function getRunningPort(toolId: string): number | undefined {
  return procs.get(toolId)?.port;
}

export async function stopAllTools(): Promise<void> {
  for (const [id] of procs) stopTool(id);
}
