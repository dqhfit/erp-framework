/* ==========================================================
   run-action.test.ts — Unit test cho runner action chain.
   ========================================================== */
import { describe, expect, it, vi } from "vitest";
import type { ProceduresClient } from "@erp-framework/client";
import { interpolate, resolveBinding, runActionSteps } from "./run-action";

function makePageState() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: (k: string) => values[k],
    set: (k: string, v: unknown) => {
      values[k] = v;
    },
  };
}

function makeCtx(
  invoke: ProceduresClient["invoke"] = vi.fn().mockResolvedValue({
    output: null,
    logs: [],
    durationMs: 0,
  }),
  confirmResult = true,
) {
  const ps = makePageState();
  const toastErrors: string[] = [];
  return {
    ctx: {
      pageState: ps,
      procClient: { invoke } as unknown as ProceduresClient,
      dialog: { confirm: vi.fn().mockResolvedValue(confirmResult) },
      toast: {
        success: vi.fn(),
        error: vi.fn((m: string) => toastErrors.push(m)),
        info: vi.fn(),
      },
      navigate: vi.fn(),
    },
    pageState: ps,
    toastErrors,
  };
}

describe("interpolate", () => {
  it("thay thế {{state.x}} bằng giá trị từ getter", () => {
    const get = (k: string) => (k === "name" ? "Bob" : undefined);
    expect(interpolate("Hello {{state.name}}!", get)).toBe("Hello Bob!");
  });
  it("missing key → chuỗi rỗng", () => {
    expect(interpolate("/x/{{state.y}}", () => undefined)).toBe("/x/");
  });
  it("non-state prefix → chuỗi rỗng (V1 chỉ state)", () => {
    expect(interpolate("{{user.name}}", () => "X")).toBe("");
  });
});

describe("resolveBinding", () => {
  const get = (k: string) => (k === "selected" ? 42 : undefined);
  it("const → trả raw value", () => {
    expect(resolveBinding({ source: "const", value: "x" }, get)).toBe("x");
  });
  it("state → đọc từ getter", () => {
    expect(resolveBinding({ source: "state", key: "selected" }, get)).toBe(42);
  });
  it("template → interpolate", () => {
    expect(resolveBinding({ source: "template", template: "id={{state.selected}}" }, get)).toBe(
      "id=42",
    );
  });
  it("undefined binding → undefined", () => {
    expect(resolveBinding(undefined, get)).toBeUndefined();
  });
});

describe("runActionSteps", () => {
  it("chain rỗng → completed=true, procedureRuns=0", async () => {
    const { ctx } = makeCtx();
    const r = await runActionSteps([], ctx);
    expect(r).toEqual({ completed: true, procedureRuns: 0 });
  });

  it("user huỷ confirm → completed=false, dừng chain", async () => {
    const invoke = vi.fn();
    const { ctx } = makeCtx(invoke as unknown as ProceduresClient["invoke"], false);
    const r = await runActionSteps(
      [
        { id: "1", kind: "confirm", message: "ok?" },
        { id: "2", kind: "procedure", procedureName: "x", args: {} },
      ],
      ctx,
    );
    expect(r.completed).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("procedure success → invalidateEntities ghi pageState['__refresh:<id>']", async () => {
    const invoke = vi.fn().mockResolvedValue({ output: { id: 7 }, logs: [], durationMs: 1 });
    const { ctx, pageState } = makeCtx(invoke as unknown as ProceduresClient["invoke"]);
    await runActionSteps(
      [
        {
          id: "1",
          kind: "procedure",
          procedureName: "create_x",
          args: {},
          saveOutputTo: "out",
          invalidateEntities: ["task"],
        },
      ],
      ctx,
    );
    expect(invoke).toHaveBeenCalledWith("create_x", {});
    expect(pageState.get("out")).toEqual({ id: 7 });
    expect(typeof pageState.get("__refresh:task")).toBe("number");
  });

  it("procedure fail → toast.error + throw, dừng step sau", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("boom"));
    const setLater = vi.fn();
    const { ctx, toastErrors } = makeCtx(invoke as unknown as ProceduresClient["invoke"]);
    // Spy set của pageState để xác nhận step "set-state" sau không chạy.
    const origSet = ctx.pageState.set;
    ctx.pageState.set = (k, v) => {
      setLater(k, v);
      origSet(k, v);
    };
    await expect(
      runActionSteps(
        [
          { id: "1", kind: "procedure", procedureName: "x", args: {} },
          { id: "2", kind: "set-state", key: "should_not", value: { source: "const", value: 1 } },
        ],
        ctx,
      ),
    ).rejects.toThrow("boom");
    expect(toastErrors[0]).toContain("boom");
    expect(setLater).not.toHaveBeenCalledWith("should_not", 1);
  });

  it("step trước set-state → step sau đọc state đồng bộ qua overlay", async () => {
    const captured: Record<string, unknown> = {};
    const invoke = vi.fn().mockImplementation((_name: string, args: Record<string, unknown>) => {
      Object.assign(captured, args);
      return Promise.resolve({ output: null, logs: [], durationMs: 0 });
    });
    const { ctx } = makeCtx(invoke as unknown as ProceduresClient["invoke"]);
    await runActionSteps(
      [
        { id: "1", kind: "set-state", key: "x", value: { source: "const", value: 99 } },
        {
          id: "2",
          kind: "procedure",
          procedureName: "p",
          args: { ref: { source: "state", key: "x" } },
        },
      ],
      ctx,
    );
    expect(captured.ref).toBe(99);
  });

  it("navigate template → interpolate href trước khi gọi navigate", async () => {
    const { ctx, pageState } = makeCtx();
    pageState.set("id", 5);
    await runActionSteps([{ id: "1", kind: "navigate", href: "/x/{{state.id}}" }], ctx);
    expect(ctx.navigate).toHaveBeenCalledWith("/x/5");
  });
});
