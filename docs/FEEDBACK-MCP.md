# MCP server cho module Phản hồi (`/mcp`)

> Cho AI bên ngoài (Claude, hoặc bất kỳ MCP client nào) **kết nối + đọc**
> các phản hồi của người dùng, xét trùng lặp, rồi **đề xuất** task fix /
> lộ trình nâng cấp / đổi trạng thái ở dạng **PENDING** để admin
> **xem trước (preview) và duyệt** mới thực thi.

## Nguyên tắc an toàn

- **AI KHÔNG mutate dữ liệu feedback trực tiếp.** MCP server chỉ có tool
  *đọc* và tool *tạo đề xuất* (`ai_proposals` ở trạng thái `pending`).
  **Không** có tool `apply`.
- Việc thực thi (đổi trạng thái / đánh dấu trùng / thêm vào lộ trình) chỉ
  xảy ra khi **admin bấm Duyệt** trong UI (`/feedback/proposals`), qua
  `applyProposalActions` chạy trong 1 transaction.
- **Deny-by-default**: API key không có scope phù hợp = không làm được gì.
- Mọi truy vấn scope theo `company_id` (đa tenant) — key của công ty nào
  chỉ thấy dữ liệu công ty đó.

## Endpoint & xác thực

| | |
|---|---|
| URL | `POST https://<server>/mcp` |
| Giao thức | JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `ping`) |
| Auth | Header `X-API-Key: sk_...` |
| Scope | `feedback:read` (đọc) · `feedback:propose` (đọc + tạo/sửa đề xuất) · `feedback:*` / `*` (toàn quyền) |

> Lưu ý Docker: nếu MCP client chạy trong một container/sidecar khác, dùng
> tên service thay vì `localhost` (vd `http://server:<port>/mcp`).

### Tạo API key

UI: **Cài đặt → API Keys → Tạo key**, chọn scope `feedback:propose`
(hoặc `feedback:read` nếu chỉ cần đọc). Sao chép `sk_...` (chỉ hiện 1 lần).

Hoặc qua tRPC `apiKeys.create` với `scopes: ["feedback:propose"]`.

## Danh sách tool

**Đọc** (`feedback:read`):

| Tool | Mô tả |
|---|---|
| `feedback_list` | Liệt kê phản hồi (lọc status/area/limit) |
| `feedback_get` | Chi tiết 1 phản hồi (kèm body, suggestion, resolutionNote) |
| `feedback_find_similar` | Tìm phản hồi tương tự (cosine embedding) theo `id` hoặc `text` |
| `feedback_cluster_duplicates` | Gom cụm trùng/giống nhau trong các mục chưa xử lý |
| `roadmap_list` | Liệt kê mục lộ trình / task-fix |
| `proposal_list` / `proposal_get` | Xem các đề xuất đã tạo |

**Đề xuất** (`feedback:propose`):

| Tool | Mô tả |
|---|---|
| `proposal_create` | Tạo đề xuất **pending** (title, summary, actions) |
| `proposal_update` | Sửa đề xuất còn pending |
| `proposal_withdraw` | Rút đề xuất pending (→ superseded) |

### Cấu trúc `actions` (cho `proposal_create`)

```jsonc
// Đổi trạng thái 1 nhóm feedback
{ "type": "set_status", "feedbackIds": ["<uuid>"], "status": "in_progress", "resolutionNote": "..." }

// Đánh dấu trùng → set trạng thái chung + ghi "Trùng với mục gốc"
{ "type": "mark_duplicate", "primaryId": "<uuid>", "duplicateIds": ["<uuid>"], "status": "wontfix" }

// Thêm vào lộ trình: tạo mới HOẶC gắn vào roadmapId có sẵn; tùy chọn đổi status nguồn
{ "type": "add_to_roadmap",
  "feedbackIds": ["<uuid>"],
  "roadmap": { "title": "Cải thiện X", "priority": "high", "area": "ui", "targetQuarter": "2026-Q3" },
  "setStatus": "in_progress" }
```

`status` feedback: `new` | `in_progress` | `done` | `wontfix`.
`status` roadmap: `planned` | `in_progress` | `done` | `dropped`.

## Ví dụ gọi trực tiếp (curl)

```bash
KEY="sk_..."
BASE="https://<server>"

# Liệt kê tool
curl -s -X POST "$BASE/mcp" -H "X-API-Key: $KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Đọc feedback chưa xử lý
curl -s -X POST "$BASE/mcp" -H "X-API-Key: $KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"feedback_list","arguments":{"status":"new","limit":50}}}'

# Tạo đề xuất pending: đổi trạng thái 1 feedback
curl -s -X POST "$BASE/mcp" -H "X-API-Key: $KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"proposal_create","arguments":{
         "title":"Xử lý nhóm bất cập UI",
         "summary":"## Bối cảnh\n3 phản hồi cùng về form đăng nhập...",
         "actions":[{"type":"set_status","feedbackIds":["<uuid>"],"status":"in_progress"}]
       }}}'
```

Kết quả `tools/call` theo chuẩn MCP: `result.content[0].text` là chuỗi JSON.

## Kết nối từ Claude

### Claude Code (CLI)

```bash
claude mcp add erp-feedback --transport http \
  --header "X-API-Key: sk_..." \
  https://<server>/mcp
```

### File cấu hình (`.mcp.json` / client hỗ trợ HTTP)

```jsonc
{
  "mcpServers": {
    "erp-feedback": {
      "type": "http",
      "url": "https://<server>/mcp",
      "headers": { "X-API-Key": "sk_..." }
    }
  }
}
```

> Với client chỉ hỗ trợ **stdio** (vd một số bản Claude Desktop), bắc cầu
> qua `mcp-remote`:
> ```jsonc
> {
>   "mcpServers": {
>     "erp-feedback": {
>       "command": "npx",
>       "args": ["-y", "mcp-remote", "https://<server>/mcp",
>                "--header", "X-API-Key:sk_..."]
>     }
>   }
> }
> ```

## Luồng làm việc gợi ý cho AI

1. `feedback_list` / `feedback_cluster_duplicates` → nắm bức tranh + tìm nhóm trùng.
2. `feedback_get` cho mục cần đọc kỹ; `feedback_find_similar` để xác nhận trùng.
3. `proposal_create` với `summary` (markdown, là **nội dung admin preview**)
   + `actions` (đổi trạng thái / `mark_duplicate` / `add_to_roadmap`).
4. **Dừng lại** — admin mở `/feedback/proposals`, xem preview, bấm
   **Duyệt & áp dụng** (hoặc **Từ chối**). Chỉ khi đó dữ liệu mới đổi.

## Tham chiếu mã

- Server: `packages/server/src/mcp-feedback.ts` (đăng ký ở `index.ts`)
- Lõi hành động: `packages/server/src/feedback-proposals.ts`
- Admin duyệt: `feedback-router.ts` (`approveProposal` / `rejectProposal`)
- UI: `src/routes/feedback.proposals.tsx`
- DB: migration `packages/db/migrations/0069_feedback_ai_proposals.sql`
  (bảng `ai_proposals`, `roadmap_items`)
- Test: `e2e/fullstack/feedback-mcp.spec.ts`
