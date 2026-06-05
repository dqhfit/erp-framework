/* ==========================================================
   feedback-mcp.spec.ts — End-to-end MCP server cho Phản hồi.
   ────────────────────────────────────────────────────────────
   Luồng kiểm: admin tạo API key scope feedback:propose → gọi
   POST /mcp (JSON-RPC) tạo proposal PENDING (set_status) → admin
   DUYỆT qua tRPC → feedback đổi trạng thái thật.
   Kèm: deny-by-default (không key = 401; key read-only không propose).

   Cần server + DB (pnpm e2e:full). Dùng page.request để chia sẻ
   cookie phiên đăng nhập với tRPC; /mcp tự xác thực bằng X-API-Key.
   ========================================================== */
import { type APIRequestContext, expect, test } from "@playwright/test";
import { ensureLoggedIn, uniqueName } from "./helpers";

/** tRPC mutation qua httpBatchLink (không transformer): body {"0": input}. */
async function trpcMutate(req: APIRequestContext, path: string, input: unknown) {
  const res = await req.post(`/trpc/${path}?batch=1`, { data: { "0": input } });
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  const j = (await res.json()) as Array<{ result: { data: unknown } }>;
  return j[0]?.result?.data as Record<string, unknown>;
}

/** tRPC query qua httpBatchLink: GET ?input={"0": input}. */
async function trpcQuery(req: APIRequestContext, path: string, input: unknown) {
  const url = `/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": input }))}`;
  const res = await req.get(url);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  const j = (await res.json()) as Array<{ result: { data: unknown } }>;
  return j[0]?.result?.data as Record<string, unknown>;
}

/** Gọi 1 tool MCP, parse JSON trong content[0].text. */
async function mcpCall(req: APIRequestContext, key: string, name: string, args: unknown) {
  const res = await req.post("/mcp", {
    headers: { "x-api-key": key },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  const j = (await res.json()) as {
    result?: { content?: Array<{ text: string }> };
    error?: { code: number; message: string };
  };
  return { status: res.status(), j };
}

test("MCP feedback: tạo proposal qua /mcp → admin duyệt → đổi trạng thái", async ({ page }) => {
  await ensureLoggedIn(page);
  const req = page.request;

  // 1) Tạo API key scope feedback:propose.
  const key = await trpcMutate(req, "apiKeys.create", {
    label: uniqueName("mcp-feedback"),
    scopes: ["feedback:propose"],
  });
  const plaintext = key.plaintext as string;
  expect(plaintext).toMatch(/^sk_/);

  // 2) Tạo 1 feedback (tRPC) để có dữ liệu thật.
  const fb = await trpcMutate(req, "feedback.create", {
    title: uniqueName("Bất cập MCP"),
    body: "Mô tả bất cập đủ dài để qua validation (min 10).",
    area: "ui",
  });
  const feedbackId = fb.id as string;
  expect(feedbackId).toBeTruthy();

  // 3) initialize + tools/list sống.
  const initRes = await req.post("/mcp", {
    headers: { "x-api-key": plaintext },
    data: { jsonrpc: "2.0", id: 0, method: "tools/list", params: {} },
  });
  const initJson = (await initRes.json()) as { result: { tools: Array<{ name: string }> } };
  const toolNames = initJson.result.tools.map((t) => t.name);
  expect(toolNames).toContain("proposal_create");
  expect(toolNames).toContain("feedback_list");

  // 4) AI tạo proposal PENDING: đổi status feedback → in_progress.
  const created = await mcpCall(req, plaintext, "proposal_create", {
    title: "Đề xuất xử lý bất cập UI",
    summary: "Gom nhóm và bắt đầu xử lý.",
    actions: [{ type: "set_status", feedbackIds: [feedbackId], status: "in_progress" }],
  });
  expect(created.status).toBe(200);
  const createdData = JSON.parse(created.j.result?.content?.[0]?.text ?? "{}");
  const proposalId = createdData.id as string;
  expect(proposalId).toBeTruthy();
  expect(createdData.status).toBe("pending");

  // 5) Trước khi duyệt: feedback vẫn "new" (AI KHÔNG mutate trực tiếp).
  const before = await trpcQuery(req, "feedback.get", feedbackId);
  expect(before.status).toBe("new");

  // 6) Admin DUYỆT qua tRPC → applyProposalActions chạy.
  const approved = await trpcMutate(req, "feedback.approveProposal", { id: proposalId });
  expect(approved.ok).toBe(true);
  expect((approved.result as { statusUpdated: number }).statusUpdated).toBe(1);

  // 7) Sau khi duyệt: feedback đổi sang in_progress.
  const after = await trpcQuery(req, "feedback.get", feedbackId);
  expect(after.status).toBe("in_progress");

  // 8) Proposal chuyển 'applied' — không duyệt lại được.
  const reAppr = await req.post("/trpc/feedback.approveProposal?batch=1", {
    data: { "0": { id: proposalId } },
  });
  const reJson = (await reAppr.json()) as Array<{ error?: unknown }>;
  expect(reJson[0]?.error).toBeTruthy();
});

test("MCP feedback: deny-by-default — không key 401, key read-only không propose", async ({
  page,
}) => {
  await ensureLoggedIn(page);
  const req = page.request;

  // Không X-API-Key → 401.
  const noKey = await req.post("/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(noKey.status()).toBe(401);

  // Key chỉ feedback:read → đọc được nhưng KHÔNG tạo proposal.
  const roKey = (
    await trpcMutate(req, "apiKeys.create", {
      label: uniqueName("mcp-ro"),
      scopes: ["feedback:read"],
    })
  ).plaintext as string;

  // feedback_list (read) OK.
  const listed = await mcpCall(req, roKey, "feedback_list", { limit: 1 });
  expect(listed.status).toBe(200);
  expect(listed.j.result?.content).toBeTruthy();

  // proposal_create (propose) bị chặn scope.
  const blocked = await mcpCall(req, roKey, "proposal_create", {
    title: "x cấm",
    actions: [{ type: "set_status", feedbackIds: [], status: "done" }],
  });
  expect(blocked.j.error).toBeTruthy();
  expect(blocked.j.error?.message).toMatch(/scope/i);
});
