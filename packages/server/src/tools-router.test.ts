/* ==========================================================
   tools-router.test.ts — Unit test tool registry + invokeAction.
   Mock toolRegistry + side effects (scan, spawn, callTool, logActivity).
   ========================================================== */
import { describe, it, expect, vi } from "vitest";
import { toolsRouter } from "./tools-router";
import { createCallerFactory } from "./trpc";
import { makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError } from "./test-helpers";

const caller = createCallerFactory(toolsRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

vi.mock("./tools", () => ({
  scanTools: vi.fn().mockResolvedValue({
    added: ["new-tool"],
    updated: [],
    errors: [],
    total: 1,
  }),
  registerRemoteTool: vi.fn().mockResolvedValue({
    id: "remote-x",
    kind: "web-app",
    runtime: "remote",
  }),
  startTool: vi.fn().mockResolvedValue({ port: 9000, pid: 1234 }),
  stopTool: vi.fn().mockReturnValue(true),
  getRunningPort: vi.fn().mockReturnValue(9000),
  invokeCli: vi.fn().mockResolvedValue({
    ok: true,
    stdout: "{}",
    stderr: "",
    exitCode: 0,
    parsed: {},
  }),
}));
vi.mock("./mcp-client", () => ({
  makeCallTool: vi.fn(() => vi.fn().mockResolvedValue({ result: "mock" })),
}));
vi.mock("./activity", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@erp-framework/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@erp-framework/core")>();
  return {
    ...actual,
    toolRegistry: {
      getById: vi.fn(() => ({
        id: "slug-1",
        manifest: {
          kind: "cli",
          runtime: "spawn",
          id: "slug-1",
          name: "x",
          displayName: "X",
          spawn: { command: "echo", args: [] },
        },
        status: "validated",
        runtimeMeta: { port: 9000 },
      })),
    },
  };
});

describe("tools-router", () => {
  describe("list", () => {
    it("trả tools + enabledForCompany từ companyTools join", async () => {
      const { db, enqueueSelect } = makeMockDb();
      // First select: tools list
      enqueueSelect([
        {
          id: VALID_UUID,
          slug: "slug-1",
          name: "Tool 1",
          displayName: "Tool 1",
          kind: "cli",
          runtime: "spawn",
          manifest: { kind: "cli" },
          source: { kind: "local" },
          enabledGlobal: true,
          updatedAt: new Date(),
        },
      ]);
      // Second select: companyTools for enabled map
      enqueueSelect([{ toolId: VALID_UUID, enabled: true, config: {} }]);
      const r = await caller(makeMockCtx({ db })).list();
      expect(r).toHaveLength(1);
      expect(r[0]?.enabledForCompany).toBe(true);
    });

    it("viewer xem được (view:settings)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      await caller(ctx).list();
    });
  });

  describe("get / getStatus / getProxyUrl", () => {
    it("get: NOT_FOUND khi tool vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).get(VALID_UUID), "NOT_FOUND");
    });

    it("get: trả tool + status từ registry", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          slug: "slug-1",
          kind: "cli",
          runtime: "spawn",
          manifest: {},
          source: {},
        },
      ]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r.status).toBe("validated");
    });

    it("getProxyUrl: trả mountPath từ manifest", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          slug: "slug-1",
          manifest: { proxy: { mountPath: "/custom/path" } },
        },
      ]);
      const r = await caller(makeMockCtx({ db })).getProxyUrl(VALID_UUID);
      expect(r.url).toBe("/custom/path");
    });
  });

  describe("rescan (admin)", () => {
    it("admin: gọi scanTools + log", async () => {
      const { db } = makeMockDb();
      const r = await caller(makeMockCtx({ db })).rescan();
      expect(r.added).toContain("new-tool");
      const { scanTools } = await import("./tools");
      expect(scanTools).toHaveBeenCalled();
    });

    it("viewer: FORBIDDEN (edit:settings)", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).rescan(), "FORBIDDEN");
    });
  });

  describe("registerRemote (SSRF guard)", () => {
    it("chặn localhost trừ khi TOOLS_ALLOW_PRIVATE_REMOTE", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).registerRemote({
            manifestUrl: "http://localhost:8080/manifest.json",
          }),
        "BAD_REQUEST",
      );
    });

    it("chặn 10.x.x.x private", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).registerRemote({
            manifestUrl: "http://10.0.0.1/manifest.json",
          }),
        "BAD_REQUEST",
      );
    });

    it("chặn 192.168.x.x", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).registerRemote({
            manifestUrl: "http://192.168.1.1/manifest.json",
          }),
        "BAD_REQUEST",
      );
    });

    it("validation: URL phải hợp lệ", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).registerRemote({ manifestUrl: "not-a-url" }),
        "BAD_REQUEST",
      );
    });
  });

  describe("enableForCompany", () => {
    it("insert mới khi chưa có companyTools row", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([]); // existing companyTools check → not found
      await caller(makeMockCtx({ db })).enableForCompany({
        toolId: VALID_UUID,
        enabled: true,
      });
      expect(ops.some((o) => o.kind === "insert")).toBe(true);
    });

    it("update khi đã có row", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([{ id: "ct_1" }]); // existing
      await caller(makeMockCtx({ db })).enableForCompany({
        toolId: VALID_UUID,
        enabled: false,
      });
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("viewer FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () =>
          caller(ctx).enableForCompany({
            toolId: VALID_UUID,
            enabled: true,
          }),
        "FORBIDDEN",
      );
    });
  });

  describe("spawn / stop", () => {
    it("spawn: gọi startTool nếu runtime=spawn", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          manifest: {
            kind: "cli",
            runtime: "spawn",
            spawn: { command: "echo" },
          },
        },
      ]);
      enqueueSelect([{ enabled: true }]); // companyTools pre-flight
      const r = await caller(makeMockCtx({ db })).spawn(VALID_UUID);
      expect(r.port).toBe(9000);
    });

    it("spawn: BAD_REQUEST nếu runtime không phải spawn", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          manifest: { kind: "web-app", runtime: "remote" },
        },
      ]);
      enqueueSelect([{ enabled: true }]); // companyTools pre-flight
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).spawn(VALID_UUID), "BAD_REQUEST");
    });

    it("stop: gọi stopTool theo slug", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ slug: "slug-1" }]);
      const r = await caller(makeMockCtx({ db })).stop(VALID_UUID);
      expect(r.ok).toBe(true);
    });
  });

  describe("invokeAction", () => {
    it("cli: gọi invokeCli + trả kết quả", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          manifest: { kind: "cli", id: "slug-1", spawn: { command: "echo" } },
        },
      ]);
      enqueueSelect([{ enabled: true }]); // companyTools pre-flight
      const r = await caller(makeMockCtx({ db })).invokeAction({
        toolId: VALID_UUID,
        action: "test",
        args: {},
      });
      expect(r.ok).toBe(true);
    });

    it("plugin kind: BAD_REQUEST (không qua invokeAction)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          manifest: { kind: "plugin", id: "p1" },
        },
      ]);
      enqueueSelect([{ enabled: true }]); // companyTools pre-flight
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () =>
          caller(ctx).invokeAction({
            toolId: VALID_UUID,
            action: "x",
          }),
        "BAD_REQUEST",
      );
    });

    it("invokeAction: FORBIDDEN khi tool chưa bật cho công ty", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          manifest: { kind: "cli", id: "slug-1", spawn: { command: "echo" } },
        },
      ]);
      enqueueSelect([]); // companyTools: chưa bật → fail-closed
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).invokeAction({ toolId: VALID_UUID, action: "x" }),
        "FORBIDDEN",
      );
    });

    it("spawn: FORBIDDEN khi tool chưa bật cho công ty", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, manifest: { kind: "cli", runtime: "spawn" } }]);
      enqueueSelect([]); // companyTools: chưa bật → fail-closed
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).spawn(VALID_UUID), "FORBIDDEN");
    });
  });
});
