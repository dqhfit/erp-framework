/* ==========================================================
   code-runner.ts — Sandbox JS cho workflow node type "code".
   Dùng isolated-vm (V8 isolate riêng + RAM/time cap).
   API tiêm vào user code:
     - vars      : snapshot biến workflow (mutate cục bộ + return để merge)
     - console.log: log → RunStep.detail
     - callTool(name, args)  : gọi MCP tool, async
     - fetch(url, init?)     : HTTP, có allowlist domain qua env
   ========================================================== */
import ivm from "isolated-vm";

function getMemMb(): number {
  return Number(process.env.CODE_NODE_MEM_MB ?? 128);
}
function getTimeoutMs(): number {
  return Number(process.env.CODE_NODE_TIMEOUT_MS ?? 5_000);
}
function getAllowlist(): string[] {
  return (process.env.CODE_NODE_FETCH_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CodeRunResult {
  output?: Record<string, unknown>;
  logs: string[];
  durationMs: number;
}

export interface MakeRunCodeDeps {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  companyId: string;
}

/** Tạo hàm runCode cho runWorkflow — đóng kín deps theo công ty. */
export function makeRunCode(deps: MakeRunCodeDeps) {
  return async function runCode(
    code: string,
    ctx: { vars: Record<string, unknown>; nodeId: string },
  ): Promise<CodeRunResult> {
    const t0 = performance.now();
    const isolate = new ivm.Isolate({ memoryLimit: getMemMb() });
    const logs: string[] = [];
    // Đọc env tại lúc gọi để test có thể đổi runtime.
    const allowlist = getAllowlist();
    const timeoutMs = getTimeoutMs();
    try {
      const context = await isolate.createContext();
      const jail = context.global;

      // vars — copy snapshot vào isolate
      await jail.set("__vars", new ivm.ExternalCopy(ctx.vars).copyInto());

      // console.log → host logs (sync, fire-and-forget)
      await jail.set(
        "__log",
        new ivm.Reference((...args: unknown[]) => {
          logs.push(
            args
              .map((a) => (typeof a === "string" ? a : safeStringify(a)))
              .join(" "),
          );
        }),
      );

      // callTool — host fn trả ExternalCopy; isolate dùng apply(promise+copy).
      // Host fn KHÔNG được throw — isolated-vm 6 không "unhandle" tốt
      // promise rejection từ host async fn (gây UnhandledPromiseRejection).
      // Wrap kết quả: { ok: true, value } | { ok: false, error }, isolate
      // sẽ tự throw ở wrapper bên trong.
      await jail.set(
        "__callTool",
        new ivm.Reference(async (name: unknown, args: unknown) => {
          try {
            if (typeof name !== "string") throw new Error("callTool: name phải là chuỗi");
            const out = await deps.callTool(
              name,
              (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
            );
            return { ok: true, value: out ?? null };
          } catch (e) {
            return { ok: false, error: (e as Error).message ?? String(e) };
          }
        }),
      );

      // fetch — host fetch + allowlist
      await jail.set(
        "__fetch",
        new ivm.Reference(async (url: unknown, init: unknown) => {
          try {
            if (typeof url !== "string") throw new Error("fetch: url phải là chuỗi");
            if (allowlist.length && !allowlist.some((d) => url.startsWith(d))) {
              throw new Error(`fetch domain không nằm trong allowlist: ${url}`);
            }
            const res = await fetch(url, (init ?? {}) as RequestInit);
            const text = await res.text();
            return { ok: true, value: { ok: res.ok, status: res.status, text } };
          } catch (e) {
            return { ok: false, error: (e as Error).message ?? String(e) };
          }
        }),
      );

      // Một script duy nhất: shim + user code + return vars.
      // Dùng IIFE để cô lập scope; trả Promise để chạy async.
      const wrapped = `
        (() => {
          const vars = __vars ?? {};
          const console = Object.freeze({
            log: (...a) => __log.applySync(undefined, a, { arguments: { copy: true } }),
          });
          const __unwrap = async (p) => {
            const r = await p;
            if (!r.ok) throw new Error(r.error);
            return r.value;
          };
          const callTool = (n, a) => __unwrap(__callTool.apply(
            undefined, [n, a],
            { arguments: { copy: true }, result: { promise: true, copy: true } },
          ));
          const fetch = (u, i) => __unwrap(__fetch.apply(
            undefined, [u, i],
            { arguments: { copy: true }, result: { promise: true, copy: true } },
          ));
          return (async () => {
            ${code}
            ;return typeof vars === 'object' ? vars : {};
          })();
        })()
      `;
      const script = await isolate.compileScript(wrapped);
      const resultCopy = await script.run(context, {
        promise: true,
        copy: true,
        timeout: timeoutMs,
      });

      const output =
        resultCopy && typeof resultCopy === "object" && !Array.isArray(resultCopy)
          ? (resultCopy as Record<string, unknown>)
          : undefined;
      return { output, logs, durationMs: Math.round(performance.now() - t0) };
    } finally {
      isolate.dispose();
    }
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
