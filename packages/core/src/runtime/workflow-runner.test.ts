import { describe, expect, it } from "vitest";
import { runWorkflow, type WfEdge, type WfNode } from "./workflow-runner";

/* Helper: node trigger + action với callTool mock trả output cố định. */
function baseOpts(nodes: WfNode[], edges: WfEdge[]) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    opt: {
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges,
      // callTool trả lại args để test bắt được input đã resolve.
      callTool: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        // Tool "fetch_order" giả lập trả một record có nested field.
        if (tool === "fetch_order") return { id: 7, customer: { email: "a@b.co" } };
        return { echoed: args };
      },
    },
  };
}

describe("workflow-runner data ports", () => {
  it("nối output node A (theo path) vào input node B", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "a",
        type: "action",
        label: "Lấy đơn",
        config: {
          tool: "fetch_order",
          // Cổng output: email bóc theo path customer.email.
          outputs: [{ id: "email", path: "customer.email" }],
        },
      },
      {
        id: "b",
        type: "action",
        label: "Gửi mail",
        config: {
          tool: "send_mail",
          // Cổng input "to" — sẽ nhận từ data-edge.
          inputs: [{ id: "to" }],
        },
      },
    ];
    const edges: WfEdge[] = [
      // Control flow: t → a → b
      { source: "t", target: "a" },
      { source: "a", target: "b" },
      // Data edge: a.email → b.to
      { source: "a", target: "b", sourceHandle: "out:email", targetHandle: "in:to" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    expect(res.status).toBe("completed");
    const sendCall = calls.find((c) => c.tool === "send_mail");
    expect(sendCall?.args.to).toBe("a@b.co");
  });

  it("dùng value tĩnh của cổng input khi không có data-edge", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "b",
        type: "action",
        label: "Gửi",
        config: { tool: "send_mail", inputs: [{ id: "to", value: "fixed@x.io" }] },
      },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "b" }];
    const { calls, opt } = baseOpts(nodes, edges);
    await runWorkflow(opt);
    expect(calls.find((c) => c.tool === "send_mail")?.args.to).toBe("fixed@x.io");
  });

  it("data-edge KHÔNG kéo control-flow (không tự chạy node đích)", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "a", type: "action", label: "A", config: { tool: "fetch_order" } },
      // b chỉ nối với a bằng DATA edge, không có control edge → không chạy.
      { id: "b", type: "action", label: "B", config: { tool: "send_mail" } },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "a" },
      { source: "a", target: "b", sourceHandle: "out:result", targetHandle: "in:x" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    expect(res.status).toBe("completed");
    expect(calls.some((c) => c.tool === "send_mail")).toBe(false);
  });

  it("topo data-dep: node nguồn chạy TRƯỚC node đích dù enqueue sau (nhánh song song)", async () => {
    // t toả ra B (tiêu thụ) TRƯỚC A (sản xuất) trong thứ tự control.
    // Chỉ có data-edge A→B (không control A→B). Topo phải chạy A trước B.
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "b",
        type: "action",
        label: "Gửi mail",
        config: { tool: "send_mail", inputs: [{ id: "to" }] },
      },
      {
        id: "a",
        type: "action",
        label: "Lấy đơn",
        config: { tool: "fetch_order", outputs: [{ id: "email", path: "customer.email" }] },
      },
    ];
    const edges: WfEdge[] = [
      // Control: t → b (trước), t → a (sau) — b sẵn sàng trước a.
      { source: "t", target: "b" },
      { source: "t", target: "a" },
      // Data: a.email → b.to
      { source: "a", target: "b", sourceHandle: "out:email", targetHandle: "in:to" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    expect(res.status).toBe("completed");
    // a phải chạy trước b
    const order = calls.map((c) => c.tool);
    expect(order.indexOf("fetch_order")).toBeLessThan(order.indexOf("send_mail"));
    expect(calls.find((c) => c.tool === "send_mail")?.args.to).toBe("a@b.co");
  });

  it("cổng output formula đọc cổng input → tính rồi cấp cho node sau", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "calc",
        type: "action",
        label: "Tính",
        config: {
          tool: "noop",
          // Cổng input tĩnh base=3; cổng output "plus" = {base} + 4 (=7).
          inputs: [{ id: "base", value: 3 }],
          outputs: [{ id: "plus", formula: "{base} + 4" }],
        },
      },
      {
        id: "b",
        type: "action",
        label: "Nhận",
        config: { tool: "send_mail", inputs: [{ id: "x" }] },
      },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "calc" },
      { source: "calc", target: "b" },
      { source: "calc", target: "b", sourceHandle: "out:plus", targetHandle: "in:x" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    expect(res.status).toBe("completed");
    expect(calls.find((c) => c.tool === "send_mail")?.args.x).toBe(7);
  });

  it("không deadlock khi data-edge nối vòng / nguồn không reachable", async () => {
    // b phụ thuộc data vào x (không có control tới x → x không bao giờ chạy).
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "x", type: "action", label: "X", config: { tool: "fetch_order" } },
      {
        id: "b",
        type: "action",
        label: "B",
        config: { tool: "send_mail", inputs: [{ id: "to" }] },
      },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "b" },
      // data x→b nhưng x không reachable qua control
      { source: "x", target: "b", sourceHandle: "out:result", targetHandle: "in:to" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    // Vẫn hoàn thành (không treo); b chạy với to=undefined.
    expect(res.status).toBe("completed");
    const send = calls.find((c) => c.tool === "send_mail");
    expect(send).toBeTruthy();
    expect(send?.args.to).toBeUndefined();
  });

  it("cổng input formula tham chiếu vars → eval rồi cấp cho node", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "a",
        type: "action",
        label: "Gửi",
        // Cổng input "amount" dùng formula {base} * 2 (không phải value tĩnh).
        config: { tool: "send", inputs: [{ id: "amount", formula: "{base} * 2" }] },
      },
    ];
    const { calls, opt } = baseOpts(nodes, [{ source: "t", target: "a" }]);
    const res = await runWorkflow({ ...opt, initialVars: { base: 50 } });
    expect(res.status).toBe("completed");
    expect(calls.find((c) => c.tool === "send")?.args.amount).toBe(100);
  });

  it("data-edge ghi đè formula của cổng input (ưu tiên cao hơn)", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "src",
        type: "action",
        label: "Nguồn",
        config: { tool: "fetch_order", outputs: [{ id: "v", path: "id" }] },
      },
      {
        id: "b",
        type: "action",
        label: "Nhận",
        config: { tool: "send_mail", inputs: [{ id: "x", formula: "{base} * 2" }] },
      },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "src" },
      { source: "src", target: "b" },
      { source: "src", target: "b", sourceHandle: "out:v", targetHandle: "in:x" },
    ];
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow({ ...opt, initialVars: { base: 50 } });
    expect(res.status).toBe("completed");
    // Edge cấp id=7 (từ fetch_order), ghi đè formula {base}*2=100.
    expect(calls.find((c) => c.tool === "send_mail")?.args.x).toBe(7);
  });

  it("backward-compat: không khai báo cổng → hành vi blackboard cũ", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "a", type: "action", label: "A", config: { tool: "fetch_order" } },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "a" }];
    const { opt } = baseOpts(nodes, edges);
    const res = await runWorkflow(opt);
    // Output object của tool vẫn merge vào vars.
    expect(res.vars.id).toBe(7);
  });
});

describe("workflow-runner switch", () => {
  /* trigger → switch({status}) → 3 nhánh action với label vip/normal/default. */
  const nodes: WfNode[] = [
    { id: "t", type: "trigger", label: "T" },
    {
      id: "sw",
      type: "switch",
      label: "SW",
      config: {
        expr: "{status}",
        cases: [
          { value: "vip", label: "vip" },
          { value: "normal", label: "normal" },
        ],
      },
    },
    { id: "av", type: "action", label: "VIP", config: { tool: "path_vip" } },
    { id: "an", type: "action", label: "NORMAL", config: { tool: "path_normal" } },
    { id: "ad", type: "action", label: "DEFAULT", config: { tool: "path_default" } },
  ];
  const edges: WfEdge[] = [
    { source: "t", target: "sw" },
    { source: "sw", target: "av", label: "vip" },
    { source: "sw", target: "an", label: "normal" },
    { source: "sw", target: "ad", label: "default" },
  ];

  it("đi đúng nhánh khi giá trị khớp case", async () => {
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow({ ...opt, initialVars: { status: "vip" } });
    expect(res.status).toBe("completed");
    const tools = calls.map((c) => c.tool);
    expect(tools).toContain("path_vip");
    expect(tools).not.toContain("path_normal");
    expect(tools).not.toContain("path_default");
  });

  it("không khớp case nào → nhánh default", async () => {
    const { calls, opt } = baseOpts(nodes, edges);
    const res = await runWorkflow({ ...opt, initialVars: { status: "khac" } });
    expect(res.status).toBe("completed");
    const tools = calls.map((c) => c.tool);
    expect(tools).toContain("path_default");
    expect(tools).not.toContain("path_vip");
  });
});

describe("workflow-runner subworkflow + foreach", () => {
  function optWith(
    nodes: WfNode[],
    edges: WfEdge[],
    runSub?: (
      id: string,
      vars: Record<string, unknown>,
    ) => Promise<{
      status: string;
      vars: Record<string, unknown>;
    }>,
  ) {
    return {
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges,
      callTool: async () => ({}),
      runSubWorkflow: runSub,
    };
  }

  it("subworkflow: merge vars con vào cha", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "s", type: "subworkflow", label: "Con", config: { workflowId: "child" } },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "s" }];
    const seen: string[] = [];
    const res = await runWorkflow(
      optWith(nodes, edges, async (id) => {
        seen.push(id);
        return { status: "completed", vars: { subResult: 42 } };
      }),
    );
    expect(res.status).toBe("completed");
    expect(seen).toEqual(["child"]);
    expect(res.vars.subResult).toBe(42);
  });

  it("subworkflow: thiếu callback → step error", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "s", type: "subworkflow", label: "Con", config: { workflowId: "child" } },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "s" }];
    const res = await runWorkflow(optWith(nodes, edges));
    expect(res.status).toBe("error");
  });

  it("foreach: chạy workflow con mỗi phần tử, gom kết quả", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "f",
        type: "foreach",
        label: "Lặp",
        config: { workflowId: "child", itemsExpr: "{list}", itemVar: "it" },
      },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "f" }];
    const items: unknown[] = [];
    const res = await runWorkflow({
      ...optWith(nodes, edges, async (_id, vars) => {
        items.push(vars.it);
        return { status: "completed", vars: { doubled: (vars.it as number) * 2 } };
      }),
      initialVars: { list: [1, 2, 3] },
    });
    expect(res.status).toBe("completed");
    expect(items).toEqual([1, 2, 3]);
    const collected = res.vars.foreach_f as Array<Record<string, unknown>>;
    expect(collected).toHaveLength(3);
    expect(collected[2]?.doubled).toBe(6);
  });

  it("foreach: mảng rỗng → ok, 0 vòng", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "f",
        type: "foreach",
        label: "Lặp",
        config: { workflowId: "child", itemsExpr: "{list}" },
      },
    ];
    const edges: WfEdge[] = [{ source: "t", target: "f" }];
    let count = 0;
    const res = await runWorkflow({
      ...optWith(nodes, edges, async () => {
        count++;
        return { status: "completed", vars: {} };
      }),
      initialVars: { list: [] },
    });
    expect(res.status).toBe("completed");
    expect(count).toBe(0);
    expect(res.vars.foreach_f).toEqual([]);
  });
});

describe("workflow-runner độ tin cậy (retry / timeout / error-branch)", () => {
  it("retry: thành công sau N lần thử", async () => {
    let attempts = 0;
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "a",
        type: "action",
        label: "Gọi",
        config: { tool: "flaky", retry: { max: 2, backoffMs: 0 } },
      },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "a" }],
      callTool: async () => {
        attempts++;
        if (attempts < 3) throw new Error("tạm lỗi");
        return { ok: true };
      },
    });
    expect(attempts).toBe(3);
    expect(res.status).toBe("completed");
  });

  it("retry: hết lượt vẫn lỗi → status error", async () => {
    let attempts = 0;
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "a",
        type: "action",
        label: "Gọi",
        config: { tool: "x", retry: { max: 1, backoffMs: 0 } },
      },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "a" }],
      callTool: async () => {
        attempts++;
        throw new Error("luôn lỗi");
      },
    });
    expect(attempts).toBe(2); // 1 gốc + 1 retry
    expect(res.status).toBe("error");
  });

  it("error-branch: node lỗi → đi nhánh 'error', không dừng workflow", async () => {
    const called: string[] = [];
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "fail", type: "action", label: "Fail", config: { tool: "boom" } },
      { id: "handler", type: "action", label: "Xử lý lỗi", config: { tool: "cleanup" } },
      { id: "after", type: "action", label: "Sau", config: { tool: "after" } },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "fail" },
      { source: "fail", target: "after" }, // nhánh thường — KHÔNG đi khi lỗi
      { source: "fail", target: "handler", label: "error" }, // nhánh lỗi
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges,
      callTool: async (tool) => {
        called.push(tool);
        if (tool === "boom") throw new Error("nổ");
        return {};
      },
    });
    expect(called).toContain("cleanup");
    expect(called).not.toContain("after");
    expect(res.status).toBe("completed"); // lỗi đã được xử lý
  });

  it("setvar: gán biến qua formula → xuống node sau", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "sv",
        type: "setvar",
        label: "Tính tổng",
        config: {
          inputs: [
            { id: "gia", value: 100 },
            { id: "sl", value: 3 },
          ],
          assignments: [{ key: "tong", formula: "{gia} * {sl}" }],
          // Cổng output "tong" bóc field tong từ rawOutput để cấp xuống.
          outputs: [{ id: "tong", path: "tong" }],
        },
      },
      {
        id: "a",
        type: "action",
        label: "Gửi",
        config: { tool: "send", inputs: [{ id: "amount" }] },
      },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "sv" },
      { source: "sv", target: "a" },
      // Nối biến tong (qua cổng output) → input amount của node sau.
      { source: "sv", target: "a", sourceHandle: "out:tong", targetHandle: "in:amount" },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      // Khai báo cổng output "tong" path "tong" để node sau bóc được.
      edges,
      callTool: async (tool, args) => {
        calls.push({ tool, args });
        return {};
      },
    });
    expect(res.status).toBe("completed");
    expect(res.vars.tong).toBe(300);
    // node setvar cũng cần cổng output "tong" để cấp xuống — bóc từ rawOutput.
    expect(calls.find((c) => c.tool === "send")?.args.amount).toBe(300);
  });

  it("timeout: node chạy quá lâu → lỗi", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "slow", type: "action", label: "Chậm", config: { tool: "slow", timeoutMs: 10 } },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "slow" }],
      callTool: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return {};
      },
    });
    expect(res.status).toBe("error");
    const slowStep = res.steps.find((s) => s.nodeId === "slow");
    expect(slowStep?.status).toBe("error");
    expect(slowStep?.detail).toContain("timeout");
  });
});

describe("workflow-runner node tích hợp (http / approval)", () => {
  it("http: gọi API, response JSON merge vào vars", async () => {
    let seen: unknown;
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "h",
        type: "http",
        label: "API",
        config: { method: "POST", url: "https://x/orders", body: { a: 1 } },
      },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "h" }],
      callTool: async () => ({}),
      runHttp: async (req) => {
        seen = req;
        return { status: 200, body: { ok: true, count: 3 } };
      },
    });
    expect(res.status).toBe("completed");
    expect((seen as { method: string }).method).toBe("POST");
    expect(res.vars.count).toBe(3);
  });

  it("http: status >= 400 → node lỗi", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "h", type: "http", label: "API", config: { url: "https://x" } },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "h" }],
      callTool: async () => ({}),
      runHttp: async () => ({ status: 503, body: "down" }),
    });
    expect(res.status).toBe("error");
    expect(res.steps.find((s) => s.nodeId === "h")?.status).toBe("error");
  });

  it("http: thiếu runHttp → lỗi", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "h", type: "http", label: "API", config: { url: "https://x" } },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "h" }],
      callTool: async () => ({}),
    });
    expect(res.status).toBe("error");
  });

  it("approval: có quyết định 'approved' → đi nhánh approved (không pause)", async () => {
    const called: string[] = [];
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "ap", type: "approval", label: "Sếp duyệt" },
      { id: "yes", type: "action", label: "Tiếp", config: { tool: "go" } },
      { id: "no", type: "action", label: "Huỷ", config: { tool: "cancel" } },
    ];
    const edges: WfEdge[] = [
      { source: "t", target: "ap" },
      { source: "ap", target: "yes", label: "approved" },
      { source: "ap", target: "no", label: "rejected" },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges,
      callTool: async (tool) => {
        called.push(tool);
        return {};
      },
      initialVars: { approval_ap: "approved" },
    });
    expect(res.status).toBe("completed");
    expect(called).toContain("go");
    expect(called).not.toContain("cancel");
  });

  it("approval: chưa có quyết định → pause", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      { id: "ap", type: "approval", label: "Sếp duyệt" },
    ];
    const res = await runWorkflow({
      workflowId: "w1",
      workflowName: "test",
      nodes,
      edges: [{ source: "t", target: "ap" }],
      callTool: async () => ({}),
    });
    expect(res.status).toBe("paused");
  });
});

describe("workflow-runner budget + foreach concurrency", () => {
  it("foreach: kết quả giữ đúng index dù sub-workflow xong lệch thứ tự", async () => {
    const nodes: WfNode[] = [
      { id: "t", type: "trigger", label: "T" },
      {
        id: "f",
        type: "foreach",
        label: "Lặp",
        config: { workflowId: "c", itemsExpr: "{list}", itemVar: "it" },
      },
    ];
    const res = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes,
      edges: [{ source: "t", target: "f" }],
      callTool: async () => ({}),
      // index nhỏ → chờ lâu hơn → hoàn tất ĐẢO thứ tự, kiểm tra ghi theo index.
      runSubWorkflow: async (_id, vars) => {
        const i = vars.index as number;
        await new Promise((r) => setTimeout(r, (4 - i) * 5));
        return { status: "completed", vars: { v: vars.it } };
      },
      initialVars: { list: [10, 20, 30, 40] },
    });
    const collected = res.vars.foreach_f as Array<Record<string, unknown>>;
    expect(collected.map((c) => c.v)).toEqual([10, 20, 30, 40]);
  });

  it("assertBudget throw trước node agent → dừng hẳn (reject), KHÔNG gọi LLM", async () => {
    let agentCalled = 0;
    await expect(
      runWorkflow({
        workflowId: "w",
        workflowName: "t",
        nodes: [
          { id: "t", type: "trigger", label: "T" },
          { id: "a", type: "agent", label: "A", config: {} },
        ],
        edges: [{ source: "t", target: "a" }],
        callTool: async () => ({}),
        callAgent: async () => {
          agentCalled++;
          return { text: "x", model: "m", usage: { input_tokens: 0, output_tokens: 0 } };
        },
        assertBudget: async () => {
          throw new Error("Vượt ngân sách tháng");
        },
      }),
    ).rejects.toThrow("Vượt ngân sách");
    expect(agentCalled).toBe(0);
  });

  it("assertBudget KHÔNG chặn node thường (vd action)", async () => {
    let budgetChecks = 0;
    const res = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes: [
        { id: "t", type: "trigger", label: "T" },
        { id: "a", type: "action", label: "A", config: { tool: "noop" } },
      ],
      edges: [{ source: "t", target: "a" }],
      callTool: async () => ({}),
      assertBudget: async () => {
        budgetChecks++;
      },
    });
    expect(res.status).toBe("completed");
    // Chỉ kiểm ngân sách cho node tốn LLM → action không kích hoạt.
    expect(budgetChecks).toBe(0);
  });
});

describe("workflow-runner resume checkpoint", () => {
  const nodes: WfNode[] = [
    { id: "t", type: "trigger", label: "T" },
    { id: "a1", type: "action", label: "A1", config: { tool: "side1" } },
    { id: "ap", type: "approval", label: "Duyệt" },
    { id: "a2", type: "action", label: "A2", config: { tool: "side2" } },
  ];
  const edges: WfEdge[] = [
    { source: "t", target: "a1" },
    { source: "a1", target: "ap" },
    { source: "ap", target: "a2", label: "approved" },
  ];

  it("approval dừng rồi resume: KHÔNG chạy lại node đã xong, đi tiếp nhánh approved", async () => {
    let act1 = 0;
    let act2 = 0;
    const callTool = async (name: string) => {
      if (name === "side1") act1++;
      if (name === "side2") act2++;
      return {};
    };
    // Lần 1: chưa có quyết định → dừng ở approval, A1 đã chạy, A2 chưa.
    const r1 = await runWorkflow({ workflowId: "w", workflowName: "t", nodes, edges, callTool });
    expect(r1.status).toBe("paused");
    expect(act1).toBe(1);
    expect(act2).toBe(0);

    // Lần 2 (resume): checkpoint = steps lần 1 + quyết định approved.
    const r2 = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes,
      edges,
      callTool,
      initialVars: { approval_ap: "approved" },
      checkpoint: { steps: r1.steps },
    });
    expect(r2.status).toBe("completed");
    expect(act1).toBe(1); // A1 KHÔNG chạy lại (chống side-effect trùng)
    expect(act2).toBe(1); // A2 chạy tiếp
  });

  it("resume với rejected: đi nhánh rejected, KHÔNG chạy node approved", async () => {
    let act2 = 0;
    const nodes2: WfNode[] = [
      ...nodes,
      { id: "a3", type: "action", label: "A3", config: { tool: "side3" } },
    ];
    const edges2: WfEdge[] = [...edges, { source: "ap", target: "a3", label: "rejected" }];
    let act3 = 0;
    const callTool = async (name: string) => {
      if (name === "side2") act2++;
      if (name === "side3") act3++;
      return {};
    };
    const r1 = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes: nodes2,
      edges: edges2,
      callTool,
    });
    const r2 = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes: nodes2,
      edges: edges2,
      callTool,
      initialVars: { approval_ap: "rejected" },
      checkpoint: { steps: r1.steps },
    });
    expect(r2.status).toBe("completed");
    expect(act2).toBe(0); // nhánh approved không chạy
    expect(act3).toBe(1); // nhánh rejected chạy
  });
});

describe("workflow-runner delay (lên lịch)", () => {
  const nodes: WfNode[] = [
    { id: "t", type: "trigger", label: "T" },
    { id: "d", type: "delay", label: "Chờ", config: { minutes: 60 } },
    { id: "a", type: "action", label: "A", config: { tool: "x" } },
  ];
  const edges: WfEdge[] = [
    { source: "t", target: "d" },
    { source: "d", target: "a" },
  ];

  it("delay dài hơn cap → paused + output.__delayMs (không sleep chặn)", async () => {
    let acted = 0;
    const callTool = async () => {
      acted++;
      return {};
    };
    const r1 = await runWorkflow({ workflowId: "w", workflowName: "t", nodes, edges, callTool });
    expect(r1.status).toBe("paused");
    expect(acted).toBe(0); // node sau delay CHƯA chạy
    const delayStep = r1.steps.find((s) => s.nodeId === "d");
    expect(delayStep?.status).toBe("paused");
    expect((delayStep?.output as { __delayMs?: number })?.__delayMs).toBe(60 * 60_000);

    // Giả lập pg-boss tới giờ → resume với delay_done_d.
    const r2 = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes,
      edges,
      callTool,
      initialVars: { delay_done_d: true },
      checkpoint: { steps: r1.steps },
    });
    expect(r2.status).toBe("completed");
    expect(acted).toBe(1); // node sau delay chạy tiếp
  });

  it("delay ngắn (≤ cap) → chờ inline, ok ngay (không paused)", async () => {
    const r = await runWorkflow({
      workflowId: "w",
      workflowName: "t",
      nodes: [
        { id: "t", type: "trigger", label: "T" },
        { id: "d", type: "delay", label: "Chờ", config: { minutes: 0 } },
      ],
      edges: [{ source: "t", target: "d" }],
      callTool: async () => ({}),
    });
    expect(r.status).toBe("completed");
    expect(r.steps.find((s) => s.nodeId === "d")?.status).toBe("ok");
  });
});
