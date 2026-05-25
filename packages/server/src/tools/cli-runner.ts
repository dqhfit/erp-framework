/* ==========================================================
   cli-runner.ts — Invoke 1 action của tool kind="cli".
   Spawn ngắn, capture stdout JSON. Long-running → enqueue
   pg-boss (chưa kế hoạch hoá — v1 chỉ chạy đồng bộ).
   ========================================================== */
import { spawn } from "node:child_process";
import type { ToolManifest } from "@erp-framework/core";

export interface CliInvokeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;
}

export async function invokeCli(
  manifest: ToolManifest,
  action: string,
  args: Record<string, unknown>,
): Promise<CliInvokeResult> {
  if (!manifest.spawn) {
    throw new Error(`Tool "${manifest.id}" thiếu cấu hình spawn`);
  }
  const argv = [
    ...(manifest.spawn.args ?? []),
    action,
    JSON.stringify(args),
  ];
  return new Promise((res) => {
    const child = spawn(manifest.spawn!.command, argv, {
      cwd: manifest.spawn!.cwd,
      env: { ...process.env, ...manifest.spawn!.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let out = "", err = "";
    child.stdout?.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.stderr?.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.on("error", (e) => res({
      ok: false, stdout: out, stderr: err + "\n" + e.message, exitCode: -1,
    }));
    child.on("exit", (code) => {
      const exit = code ?? -1;
      let parsed: unknown;
      try { parsed = JSON.parse(out); } catch { /* không phải JSON */ }
      res({ ok: exit === 0, stdout: out, stderr: err, exitCode: exit, parsed });
    });
  });
}
