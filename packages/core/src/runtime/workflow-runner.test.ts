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
