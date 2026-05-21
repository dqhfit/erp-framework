# R6 — Agent chat qua backend (streaming + vòng lặp tool)

Quyết định đã chốt: (1) streaming token CÓ, (2) giữ vòng gọi MCP tool CÓ.

Đây là một feature build, cần làm theo 3 bước, **build/chạy thật sau mỗi
bước** — không one-shot.

## Hiện trạng
- Agent chat chạy client-side: `src/core/agent-runner.ts` (vòng lặp tool)
  + `src/core/llm/*` (adapter) + `AgentPanel.tsx`. Đang hoạt động.
- Server: `llm-client.ts` (gọi Anthropic/OpenAI, KHÔNG tool, KHÔNG stream),
  `mcp-client.ts` (`mcpToolsCall`). `agents` table có config.

## Bước 1 — Server: module agentic loop
`packages/server/src/agent-chat.ts`:
- `runAgentChat({ db, profileName, system, messages, tools, onEvent })`.
- Gọi Anthropic `/v1/messages` với `tools` + `stream: true`.
- Parse SSE của Anthropic: `content_block_delta` (text delta → onEvent
  `token`), `content_block_start` type `tool_use`, `message_delta`
  (`stop_reason`).
- Khi `stop_reason === "tool_use"`: gom các `tool_use`, gọi `makeCallTool(db)`
  cho từng tool (onEvent `tool_call`/`tool_result`), append `tool_result`
  blocks, lặp lại. Tối đa 6 vòng.
- Port logic vòng lặp từ `src/core/agent-runner.ts` (đã có sẵn, chỉ đổi
  nguồn LLM sang streaming server-side).
**Verify bước 1**: unit-test parse SSE Anthropic với fixture.

## Bước 2 — Server: route SSE
Trong `index.ts`, route `POST /agent/chat`:
- Kiểm session (đọc cookie `sid`, tra bảng `sessions`) → 401 nếu sai.
- `reply.raw.writeHead(200, { "content-type": "text/event-stream", ... })`.
- Gọi `runAgentChat`, mỗi `onEvent` → `reply.raw.write('data: '+JSON+'\n\n')`.
- Kết thúc → event `done` + `reply.raw.end()`.
- nginx (`docker/nginx.conf`) đã có `proxy_buffering off` cho khối tương tự
  — thêm `location /agent/` proxy sang `server:8910`.
**Verify bước 2**: `curl -N` vào `/agent/chat` xem stream chảy.

## Bước 3 — App: AgentPanel tiêu thụ stream
- `AgentPanel.send()`: thay `runAgent` client bằng `fetch("/agent/chat",
  { method, body, credentials })`, đọc `res.body` qua `ReadableStream`
  reader, tách event SSE, cập nhật message theo `token`/`tool_call`/
  `tool_result`/`done`.
- Bỏ phụ thuộc `src/core/agent-runner.ts` (client) — sau đó file này +
  một phần `src/core/llm` có thể dọn.
**Verify bước 3**: chat thật trong app, thấy token chảy + tool call hiện.

## Quyết định kỹ thuật còn mở
- Adapter: bước đầu chỉ Anthropic (agent mẫu dùng claude). OpenAI
  function-calling khác format — làm sau.
- Credential: server đọc `llm_profiles.apiKeyEnc` (đã mã hoá). Luồng
  bridge/OAuth hiện ở trình duyệt — agent backend KHÔNG dùng được; cần
  một LLM profile có API key thật.
