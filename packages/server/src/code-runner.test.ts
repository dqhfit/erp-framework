import { describe, it, expect, vi } from "vitest";
import { makeRunCode } from "./code-runner";

const noopCallTool = vi.fn(async (_n: string, _a: Record<string, unknown>) => ({}));

describe("makeRunCode", () => {
  it("happy path: read vars, return merged output", async () => {
    const runCode = makeRunCode({ callTool: noopCallTool, companyId: "co_1" });
    const r = await runCode("vars.b = vars.a + 1; return vars;", {
      vars: { a: 41 },
      nodeId: "n1",
    });
    expect(r.output).toEqual({ a: 41, b: 42 });
    expect(r.logs).toEqual([]);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("console.log captured in logs", async () => {
    const runCode = makeRunCode({ callTool: noopCallTool, companyId: "co_1" });
    const r = await runCode(`console.log("hi", 1, {x:2}); return vars;`, {
      vars: {},
      nodeId: "n1",
    });
    expect(r.logs[0]).toMatch(/hi 1 \{"x":2\}/);
  });

  it("callTool — args passed through, result merged", async () => {
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("ping");
      expect(args).toEqual({ a: 1 });
      return { pong: true };
    });
    const runCode = makeRunCode({ callTool, companyId: "co_1" });
    const r = await runCode(
      `const x = await callTool("ping", { a: 1 }); vars.x = x; return vars;`,
      { vars: {}, nodeId: "n1" },
    );
    expect(callTool).toHaveBeenCalledOnce();
    expect((r.output as { x: { pong: boolean } }).x).toEqual({ pong: true });
  });

  it("timeout: infinite loop errors out", async () => {
    process.env.CODE_NODE_TIMEOUT_MS = "200";
    // Re-import is overkill; new instance reads env at module load. The
    // exported makeRunCode captures env at the *top level* of code-runner.ts.
    // So this test verifies the wrapper still rejects via isolate timeout.
    const runCode = makeRunCode({ callTool: noopCallTool, companyId: "co_1" });
    await expect(
      runCode(`while(true){};`, { vars: {}, nodeId: "n1" }),
    ).rejects.toThrow(/timed out|timeout/i);
  });

  it("no leakage: process/require/import are not defined", async () => {
    const runCode = makeRunCode({ callTool: noopCallTool, companyId: "co_1" });
    await expect(
      runCode(`return { p: typeof process, r: typeof require };`, {
        vars: {},
        nodeId: "n1",
      }),
    ).resolves.toMatchObject({
      output: { p: "undefined", r: "undefined" },
    });
  });

  it("fetch allowlist rejects URL not in list", async () => {
    process.env.CODE_NODE_FETCH_ALLOWLIST = "https://example.com";
    // Note: FETCH_ALLOWLIST evaluated at module-load time inside
    // code-runner.ts; vitest caches the module so the env set here only
    // affects fresh imports. We dynamic-import a fresh copy.
    vi.resetModules();
    const { makeRunCode: fresh } = await import("./code-runner");
    const runCode = fresh({ callTool: noopCallTool, companyId: "co_1" });
    await expect(
      runCode(`await fetch("https://evil.example/x"); return vars;`, {
        vars: {},
        nodeId: "n1",
      }),
    ).rejects.toThrow(/allowlist/);
    delete process.env.CODE_NODE_FETCH_ALLOWLIST;
  });
});
