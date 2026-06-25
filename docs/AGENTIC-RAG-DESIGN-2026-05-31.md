# Thiết kế Agentic RAG cho module Tri thức

> Trạng thái: ĐỀ XUẤT (chưa code). Ngày: 2026-05-31.
> Tác giả: phiên làm việc với Claude Code.
> Liên quan: hybrid retrieval đã hoàn thành (`knowledge-search.ts`,
> migration `0062_knowledge_chunks_fts.sql`).

## 0. Mục tiêu & phi-mục-tiêu

**Mục tiêu**
- Nâng RAG hiện tại (1-shot hybrid) thành **agentic**: agent tự lập kế
  hoạch truy vấn, chấm điểm kết quả, tự sửa, và định tuyến nguồn.
- Tận dụng tối đa hạ tầng sẵn có (vòng lặp tool đã chạy), thêm ít mặt
  phẳng mới nhất có thể.
- Giữ nguyên triết lý: **fail-safe** (AI lỗi không vỡ chat), **multi-tenant**
  (mọi tool scope theo `company_id`), **rẻ-mặc-định / sâu-tùy-chọn**.

**Phi-mục-tiêu**
- KHÔNG nhúng `microsoft/graphrag` (đã loại ở phân tích trước — lệch
  stack Python, multi-tenant kém, chi phí index LLM cao).
- KHÔNG đổi mô hình lưu trữ KB (`knowledge_sources` / `knowledge_chunks`
  giữ nguyên).
- KHÔNG bắt buộc agentic cho mọi lượt chat — chỉ khi cần / khi bật.

## 1. Kiến trúc hiện tại (điểm xuất phát)

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| Hybrid retrieval | `packages/server/src/knowledge-search.ts` | vector(HNSW) + FTS(GIN) hoà RRF; `knowledgeSearch(db, companyId, query, limit)` |
| Vòng lặp agentic | `packages/server/src/agent-chat.ts` | `runAgentChat`, `MAX_ROUNDS=6`, `TRIM=8000`; 2 nhánh `anthropicLoop` / `openaiLoop` |
| Tool-calling mọi adapter | `scripts/claude-bridge.mjs:116-330` | native (Anthropic/OpenAI) + **emulation prompt** cho claude-cli; Ollama qua OpenAI-compat |
| Tool KB | `index.ts:50-104` | `KB_SEARCH_TOOL` (chỉ `{query}`), `KB_ADD_TOOL` (`{title,content}`) |
| Lắp tool + callTool | `index.ts:378-425` | closure bind `active.companyId` → multi-tenant; RBAC `canAddKb` |
| Auto-RAG thụ động | `index.ts:354-376` | chèn top-5 KB vào system prompt MỖI lượt; fail-safe try/catch |
| LLM 1-shot helper | `packages/server/src/llm-json.ts` | `callLlmJson<T>(db, companyId, {system, user, maxTokens?})` → `T \| null` |
| Record search (cấu trúc) | `router-helpers.ts:180` | `buildRecordWhere` — FTS `searchTsv @@ websearch_to_tsquery` + filter ops |

**Kết luận:** bộ máy agentic đã đủ. Thiếu *chất lượng agency*: query
planning, grading, source routing, citation. 4 phase dưới đây lấp dần.

## 1.5. QUYẾT ĐỊNH KIẾN TRÚC — Server-orchestrated (tối ưu cho claude-cli)

> Đây là quyết định chốt, định hình toàn bộ các phase còn lại.

Có hai kiểu "agentic" RAG:

| | **Autonomous agent** (LLM tự lái) | **Orchestrated workflow** (server lái) ✅ CHỌN |
|---|---|---|
| Ai quyết định gọi tool | LLM, qua `tool_use` block | Code TS server, tuần tự xác định |
| Trên claude-cli | **Emulation prompt** — model phải xuất đúng khối ` ```tool_call `; mỗi vòng spawn `claude -p` mới | Mỗi bước = `callLlmJson` 1-shot JSON (**không** emulation) |
| Độ tin cậy / claude-cli | Dễ vỡ (model quên/sai định dạng) | Cao — đường JSON đã chứng minh (feedback/enum/procedure) |
| Số call LLM | Bất định, tới `MAX_ROUNDS=6` spawn | Cố định nhỏ: 1 plan + 1 grade + 1 answer (≤3) |
| Độ trễ / claude-cli | Bất định × ~38s/spawn | Dự đoán được |

**Vì sao orchestrated tối ưu cho claude-cli:** bridge spawn CLI mỗi call
và tool-calling chỉ là emulation → vòng lặp tự động vừa chậm vừa dễ vỡ.
Ngược lại `callLlmJson` (prompt→JSON→regex extract) là đường **đáng tin
nhất** trên bridge. Vậy ta đặt *agency vào code server* (plan → search →
grade → correct → answer), mỗi bước suy luận là 1 lời gọi `callLlmJson`.

**Mô hình hợp nhất:** một hàm server `agenticRetrieve(db, companyId, query,
opts)` là nguồn agency duy nhất, **chạy cho MỌI adapter** (gồm claude-cli).
Kết quả (đã chấm + trích nguồn) được chèn vào system prompt như auto-RAG
hiện tại, rồi **1 lời gọi sinh câu trả lời cuối** qua `runAgentChat`.

```
agenticRetrieve(query):
  1. queries = planQueries(query)          # 1× callLlmJson (JSON, ổn trên bridge)
  2. hits    = dedupe( ∥ hybridSearch(qᵢ) ) # 0 LLM — pgvector + FTS
  3. if topScore < STRONG:                  # cổng heuristic, đa số bỏ qua
       g = grade(query, hits)               # 1× callLlmJson
       if !g.relevant && g.suggestedQuery: hits = hybridSearch(g.suggestedQuery)  # 0 LLM
       else:                                hits = filter(hits, g.usableChunkIds)
  4. return { hits, sources, notes }        # → chèn vào system prompt + chỉ thị cite
→ runAgentChat(system + ngữ cảnh) = 1 call sinh đáp án
```

**Tiered theo chi phí (tôn trọng "rẻ mặc định"):**
- **Fast (mặc định):** hybridSearch → inject → answer (1 call). = hành vi auto-RAG hiện tại.
- **Deep (toggle "Tìm sâu"):** plan → search → grade → correct → inject+cite → answer (≤3 call).

**Autonomous tool-loop KHÔNG bỏ** — giữ `knowledge_search`/`records_search`
như tool **opt-in cho adapter native** (Anthropic/OpenAI) muốn agent tự
lái multi-hop. Nhưng đó là *bonus*, KHÔNG phải đường chính. Đường chính
(orchestrated) chạy tốt trên claude-cli.

## 2. Nguyên tắc thiết kế xuyên suốt

1. **Fail-safe phân tầng** — mọi bước LLM phụ (rewrite, grade) qua
   `callLlmJson`, lỗi/null → lùi về hành vi 1-shot hiện tại. Không bao
   giờ để bước "thông minh" làm vỡ truy hồi cơ bản.
2. **Thích ứng năng lực adapter** — agentic sâu chỉ bật cho profile
   tool-calling đáng tin (native Anthropic/OpenAI). claude-cli (emulation)
   và Ollama nhỏ → giữ auto-RAG 1-shot. Năng lực suy ra từ adapter.
3. **Multi-tenant fail-closed** — mọi tool mới nhận `companyId` từ closure
   server, KHÔNG từ args của LLM. RBAC kiểm trước khi chạy.
4. **Rẻ mặc định** — agentic = nhiều round = nhiều token. Mặc định OFF;
   bật qua toggle "Tìm sâu" hoặc khi grading báo kết quả yếu.
5. **Quan sát được** — mỗi bước ghi `logActivity` (kind=embedding/llm) để
   theo dõi chi phí token theo tenant.

---

## 3. PHASE 1 — Tool truy hồi giàu hơn + Query rewrite

**Vấn đề:** `knowledge_search` chỉ nhận `{query}` thô; agent không lọc
được theo loại nguồn, không lấy được nguyên văn nguồn, query mơ hồ.

### 3.1 Tool contract mới — `knowledge_search`

```jsonc
{
  "name": "knowledge_search",
  "description": "Tra cứu Knowledge Base nội bộ. Trả các đoạn liên quan kèm sourceId + score. Dùng filter sourceKind khi biết loại nguồn; tăng k khi câu hỏi rộng.",
  "schema": {
    "type": "object",
    "properties": {
      "query":      { "type": "string", "description": "Câu hỏi/từ khoá. Nên cụ thể, tách 1 ý/lần." },
      "k":          { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 },
      "sourceKind": { "type": "string", "enum": ["file", "entity", "text"], "description": "Lọc theo loại nguồn (bỏ trống = tất cả)." }
    },
    "required": ["query"]
  }
}
```

### 3.2 Đổi chữ ký `knowledgeSearch`

```ts
// knowledge-search.ts
export interface KnowledgeSearchOpts {
  limit?: number;            // mặc định 5, clamp 1..20
  sourceKind?: "file" | "entity" | "text";
}
export async function knowledgeSearch(
  db: DB, companyId: string, query: string, opts: KnowledgeSearchOpts = {},
): Promise<KnowledgeHit[]>
```
- Thêm điều kiện `AND s.kind = ${sourceKind}` (cả nhánh hybrid lẫn
  FTS-only) khi có filter.
- **Backward-compat:** caller cũ truyền số (`limit`) — đổi sang
  `{limit}` ở cả 3 call-site (`index.ts:365,397`, `knowledge-router.ts:204`).
  (Hoặc overload chấp nhận `number | opts` để giảm đụng chạm.)
- Tool mới hỗ trợ `expandToSource` ở P3 (xem 5.x) — P1 chỉ `k`+`sourceKind`.

### 3.3 Query rewrite (tiền xử lý, fail-safe)

Một bước LLM rẻ TRƯỚC khi search, biến câu hỏi user thô → 1-3 truy vấn
con cụ thể. Đặt ở `knowledge-search.ts` (hàm mới `planQueries`) hoặc file
mới `knowledge-agentic.ts`.

```ts
interface QueryPlan { queries: string[]; reason: string; }

async function planQueries(db, companyId, userQuery): Promise<string[]> {
  const plan = await callLlmJson<QueryPlan>(db, companyId, {
    system: QUERY_REWRITE_SYSTEM,
    user: userQuery,
    maxTokens: 256,
  });
  // Fail-safe: null/rỗng → dùng nguyên query gốc.
  const qs = plan?.queries?.filter((q) => q.trim()).slice(0, 3) ?? [];
  return qs.length ? qs : [userQuery];
}
```

**Prompt** (`QUERY_REWRITE_SYSTEM`):
```
Bạn là bộ viết lại truy vấn cho hệ thống tra cứu tài liệu nội bộ doanh nghiệp.
Nhiệm vụ: từ câu hỏi của người dùng, sinh 1–3 truy vấn tìm kiếm NGẮN, CỤ THỂ,
mỗi truy vấn nhắm 1 khía cạnh. Mở rộng viết tắt/mã nếu rõ. KHÔNG bịa thông tin.
Nếu câu hỏi đã đủ cụ thể, trả đúng 1 truy vấn là chính nó.
Trả JSON: {"queries": ["...", "..."], "reason": "ngắn gọn"}.
```

Nhiều truy vấn → chạy `knowledgeSearch` song song (`Promise.all`), gộp +
khử trùng theo `chunkId`, giữ `score` cao nhất, cắt top-k.

### 3.4 Tích hợp
- **Đường tool (agentic):** `knowledge_search` callTool đọc `k`+`sourceKind`,
  KHÔNG tự rewrite (agent tự lo planning qua nhiều lần gọi tool).
- **Đường auto-RAG (thụ động, `index.ts:365`):** chèn `planQueries` để cải
  thiện recall ngay cả khi model không tool-call. Đây là nơi rewrite có
  giá trị nhất (bù cho việc claude-cli/Ollama không lặp tốt).

---

## 4. PHASE 2 — CRAG-lite: chấm điểm & tự sửa truy hồi

**Vấn đề:** truy hồi yếu vẫn được nhét vào prompt → model bịa hoặc trả
sai. Cần *chấm* relevance, kém thì viết lại & tìm lại, rỗng thì thừa nhận.

### 4.1 Heuristic trước, LLM sau (rẻ → đắt)
- **Tầng 0 (rẻ):** đã có `MIN_SCORE` + RRF. Nếu top-1 `score >= STRONG`
  (vd 0.55) → coi như đủ, bỏ qua grading.
- **Tầng 1 (LLM, chỉ khi mơ hồ):** điểm 0.2–0.55 → gọi grader.

### 4.2 Grader contract (`callLlmJson`)
```ts
interface GradeResult {
  relevant: boolean;          // tập hits có trả lời được câu hỏi không
  usableChunkIds: string[];   // chunk thực sự liên quan
  suggestedQuery?: string;    // nếu không liên quan, gợi ý truy vấn mới
}
```
**Prompt** (`GRADE_SYSTEM`):
```
Bạn là bộ chấm độ liên quan cho RAG. Cho CÂU HỎI và danh sách ĐOẠN (kèm id).
Quyết định: các đoạn có đủ thông tin trả lời câu hỏi không?
- relevant=true nếu có ít nhất 1 đoạn trực tiếp liên quan; liệt kê usableChunkIds.
- relevant=false nếu lạc đề; đề xuất suggestedQuery viết lại tốt hơn.
Chỉ căn cứ nội dung đoạn, KHÔNG dùng kiến thức ngoài. Trả JSON đúng schema.
```

### 4.3 Vòng tự sửa (corrective loop)
```
hits = search(planQueries(q))
if topScore < STRONG:
    g = grade(q, hits)            # fail-safe: null → coi relevant=true
    if g and not g.relevant and g.suggestedQuery and chưa retry:
        hits = search([g.suggestedQuery])   # tìm lại 1 lần
    elif g and g.usableChunkIds:
        hits = hits.filter(id in usableChunkIds)
if hits rỗng:
    trả tín hiệu "không tìm thấy" → agent/answer nói thẳng, không bịa
```
- Giới hạn **1 lần** retry (chặn chi phí + lang thang).
- Đặt trong `knowledge-agentic.ts` như `agenticRetrieve(db, companyId, q, opts)`
  → trả `{ hits, gradedOut: boolean, notes }`. Tool `knowledge_search` và
  auto-RAG đều có thể gọi (auto-RAG dùng bản có grading khi bật deep mode).

### 4.4 Lưu ý
- Grading = +1 LLM call/lượt yếu. Chỉ kích hoạt khi `score` mơ hồ → đa số
  truy vấn tốt KHÔNG phải trả phí thêm.
- Toàn bộ fail-safe: grader null → hành vi P1.

---

## 5. PHASE 3 — Source routing: tool `records_search` (dữ liệu cấu trúc)

**Ý tưởng cốt lõi:** ERP đã có "graph quan hệ" trong `entity_records`.
Cho agent một tool truy DỮ LIỆU CẤU TRÚC, tự chọn giữa KB (văn bản) và
records (số liệu/bản ghi). Đây là khác biệt thật so với RAG tài liệu thuần.

### 5.1 Tool contract — `records_search`
```jsonc
{
  "name": "records_search",
  "description": "Tìm bản ghi dữ liệu có cấu trúc của một entity (vd đơn hàng, khách hàng, sản phẩm). Dùng khi câu hỏi về SỐ LIỆU/BẢN GHI cụ thể, không phải văn bản tài liệu.",
  "schema": {
    "type": "object",
    "properties": {
      "entity":  { "type": "string", "description": "Tên/slug entity (vd 'don_hang')." },
      "q":       { "type": "string", "description": "Từ khoá full-text trên các field searchable." },
      "filters": { "type": "object", "description": "Lọc theo field: { field: { op, value } }, op ∈ =,!=,contains,>,>=,<,<=." },
      "limit":   { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
    },
    "required": ["entity"]
  }
}
```

### 5.2 Triển khai (tái dùng tối đa)
- Resolve `entity` → `entityId` trong `companyId` (lookup `entities` theo
  name/slug; case-insensitive — đã có unique index `0052`).
- Dựng WHERE bằng **`buildRecordWhere(companyId, entityId, {q, filters})`**
  (router-helpers.ts:180) — đã có FTS + filter ops sẵn.
- Trả về tập field rút gọn (id + vài field hiển thị) để tiết kiệm token.

### 5.3 RBAC (BẮT BUỘC)
- `records_search` callTool phải kiểm `roleCan(active.role, "view", "record")`
  (hoặc `rbacProcedure` tương đương) TRƯỚC khi chạy — KHÔNG cấp mặc định.
- **Field-level RBAC:** áp `stripUnreadableFields` lên kết quả (đồng nhất
  với `records.export` — CLAUDE.md §4). Không để agent lộ field cấm.
- Chỉ cấp tool này khi role đủ quyền (như `canAddKb` gate `KB_ADD_TOOL`).

### 5.4 Mở rộng `knowledge_search`: `expandToSource`
- Thêm param `expandToSource: boolean` — khi true và hit thuộc 1 source,
  trả thêm vài chunk lân cận (theo `seq`) hoặc toàn source nếu nhỏ. Giúp
  agent đọc đủ ngữ cảnh thay vì 1 chunk cụt.

---

## 6. PHASE 4 — Chế độ "Tìm sâu" tường minh + Citation

### 6.1 Bật/tắt agentic
- **Toggle UI** trong khung chat KB ("Tìm sâu" / deep search). Mặc định OFF.
- Truyền cờ `deepSearch: boolean` trong body `/agent/chat`.
- **Pipeline orchestrated (§1.5) chạy cho MỌI adapter** gồm claude-cli —
  vì plan/grade đi qua `callLlmJson` (không phụ thuộc tool-calling).
  - `deepSearch=false` → Fast: hybridSearch → inject → answer.
  - `deepSearch=true`  → Deep: plan → search → grade → correct → cite → answer.
- **Autonomous tool-loop (opt-in):** chỉ với adapter native {anthropic,
  openai} mới *thêm* `knowledge_search`/`records_search` vào `tools` để
  agent tự lái. claude-cli/ollama → KHÔNG cấp tool tự-lái (tránh emulation
  dễ vỡ), dựa hoàn toàn vào pipeline orchestrated. Suy năng lực qua
  `adapterFamily(inferAdapterFromModel(...))`.

### 6.2 Citation / grounding (xuyên các phase)
- Mọi đoạn truy hồi đã có `sourceId` + `sourceTitle`. Bổ sung **chỉ thị
  system** buộc trả lời trích nguồn:
```
Khi dùng thông tin từ kết quả tra cứu, trích nguồn dạng [#sourceTitle].
CHỈ trả lời dựa trên nội dung đã truy hồi. Nếu không có thông tin, nói rõ
"Không tìm thấy trong tri thức nội bộ" — TUYỆT ĐỐI không bịa.
```
- Có thể trả kèm danh sách nguồn ở cuối (đã có dữ liệu, chỉ cần render).

### 6.3 (Tùy chọn) Lưu vết hội thoại agentic
- `agent_conversations` (đã có, migration `0053`) có thể lưu thêm meta:
  các truy vấn con đã chạy + nguồn đã trích, để audit/explainability.
  Cân nhắc cột `jsonb retrieval_trace` nếu cần — KHÔNG bắt buộc cho MVP.

---

## 7. Tổng hợp thay đổi & rủi ro

### 7.1 File chạm
| File | Phase | Loại |
|---|---|---|
| `knowledge-search.ts` | P1 | đổi chữ ký + filter sourceKind |
| `knowledge-agentic.ts` (mới) | P1-2 | planQueries, agenticRetrieve, grader |
| `index.ts` | P1-4 | tool schema mới, callTool `records_search`, cờ deepSearch, system citation |
| `router-helpers.ts` | P3 | tái dùng `buildRecordWhere` (không sửa) |
| `knowledge-router.ts` | P1 | cập nhật call-site `knowledgeSearch` |
| `src/routes/*` (UI chat) | P4 | toggle "Tìm sâu" |
| `agent-chat.ts` | — | KHÔNG đổi (loop đã đủ) |

### 7.2 DB / migration
- **P1-2:** KHÔNG cần migration (dùng cột sẵn có).
- **P4 (tùy chọn):** nếu lưu `retrieval_trace` → 1 migration thêm cột jsonb
  vào `agent_conversations`. Theo CLAUDE.md: timestamp `when` unique tăng
  dần, comment SQL ASCII-only.

### 7.3 Rủi ro & giảm thiểu
| Rủi ro | Giảm thiểu |
|---|---|
| Chi phí token tăng (nhiều round) | Mặc định OFF; grading chỉ khi score mơ hồ; retry tối đa 1 |
| claude-cli emulation tool fragile | Cổng năng lực; auto-RAG+rewrite làm nền |
| Agent lộ dữ liệu cấm (records) | RBAC + field-level strip BẮT BUỘC ở `records_search` |
| Lang thang vòng lặp | `MAX_ROUNDS=6` sẵn + grading hội tụ + cite-or-refuse |
| Vỡ truy hồi cơ bản do bước AI phụ | Fail-safe phân tầng: null → lùi 1-shot |

---

## 8. Test
- **Unit (✅ làm):** `mergeHits` (dedupe/max-score/sort/limit) + `filterUsable`
  (lọc usableChunkIds, id lạ → giữ nguyên) — `knowledge-agentic.test.ts`,
  6 ca pass. Phần gọi LLM (`planQueries`/`gradeHits`) fail-safe theo thiết
  kế, kiểm bằng e2e/manual.
- **E2E fullstack (✅ làm):** `agentic-rag.spec.ts` — P3 opt-in: toggle
  `agentSearchable` (tab MCP designer) ghi DB qua `setAgentSearchable` và
  BỀN sau reload (bật→reload→vẫn bật→tắt→reload→vẫn tắt). Deterministic,
  không cần LLM. (Đã `--list` xác nhận parse; chạy thật cần `pnpm e2e:full`.)
- **Harness (✅ sửa):** suite fullstack từng đổ hàng loạt vì mỗi test tự
  login → vượt rate-limit `auth.login` (5/15min/IP). Đã chuyển sang
  storageState: `auth.setup.ts` login 1 lần (setup project) → mọi test
  tái dùng cookie; `ensureLoggedIn` short-circuit nếu đã đăng nhập. Tổng
  ~2 login/run.
- **Còn (cần môi trường sống):** KB hybrid + `sourceKind` filter (stub
  embedding); luồng "Tìm sâu" plan/grade (cần stub trả JSON — hiện stub
  trả text → deep degrade fast theo fail-safe).

## 9. Thứ tự thực thi & trạng thái
1. **P1** (rewrite + tool params) — ✅ XONG. `knowledge-agentic.ts`
   (`planQueries`/`mergeHits`/`agenticRetrieve`), tool `knowledge_search`
   thêm `k`+`sourceKind`, auto-RAG qua `agenticRetrieve` (Fast mặc định).
2. **P2** (CRAG-lite) — ✅ XONG. `gradeHits`/`filterUsable` + cổng
   heuristic `STRONG_SCORE=0.55`, tự sửa retry 1 lần, `gradedOut` trong
   kết quả. Dormant đến khi P4 bật `grade=true`.
3. **P3** (records routing) — ✅ XONG (server + UI). Tool `records_search`
   (`index.ts`): gate `view:entity` + deny-by-default `meta.agentSearchable`
   + `buildRecordWhere` (FTS/filter) + `decryptDataOut` + `stripUnreadableFields`.
   Opt-in qua mutation `entities.setAgentSearchable` + toggle UI
   `AgentSearchableToggle` (tab "mcp" của EntityDesigner — tự chứa, đọc/ghi
   trực tiếp qua client, không đụng store/save của designer).
4. **P4** (deep toggle + citation) — ✅ XONG. Cờ `deepSearch` (body
   `/agent/chat`) bật `plan+grade`; auto-RAG tiêu thụ `gradedOut` (lạc đề
   → nhắc "không tìm thấy", không chèn rác); chỉ thị trích nguồn inline
   `[#tên nguồn]`; toggle "Tìm sâu" (I.Sparkles) trong `AgentPanel`.
5. **P5** (Query routing) — ✅ XONG. `routeQuery`/`normalizeRoute`
   (`knowledge-agentic.ts`) phân loại ý định → KB / records / web / direct
   cho MỌI adapter; dispatch ở auto-RAG (`index.ts`) sang `agenticRetrieve`
   và/hoặc `searchAgentRecords` (helper mới, dùng chung với tool); cờ
   `smartRoute` + toggle "Định tuyến" (I.GitBranch). Xem §11.

## 10. Câu hỏi cần chốt (trước khi code)
1. ~~Phạm vi adapter agentic~~ → **ĐÃ CHỐT (§1.5):** pipeline
   server-orchestrated chạy mọi adapter gồm claude-cli; tool tự-lái chỉ
   opt-in cho native.
2. ~~`records_search` MVP~~ → **ĐÃ CHỐT (mặc định):** deny-by-default —
   chỉ entity có cờ opt-in `agentSearchable=true` + role có `view:record`.
   Hợp văn hoá fail-closed (§4 CLAUDE.md). *(triển khai ở P3.)*
3. ~~Citation~~ → **ĐÃ CHỐT (mặc định):** inline `[#tên nguồn]`. *(P4.)*
4. ~~`retrieval_trace`~~ → **ĐÃ CHỐT (mặc định):** KHÔNG lưu ở MVP; chỉ
   `logActivity` đo token. Thêm trace sau nếu cần audit. *(P4.)*

> Cả 3 mặc định thuộc P3/P4 — không chặn P1. P1 bắt đầu code ngay.

---

## 11. PHASE 5 — Query routing (định tuyến truy vấn) ✅ XONG

> Trạng thái: ĐÃ CODE (2026-06-25). Bổ sung sau P1–P4.

**Vấn đề còn lại sau P1–P4.** Source routing KB↔records (P3) CHỈ chạy ở nhánh
*autonomous tool-loop* — tức adapter native (Anthropic/OpenAI) tự gọi
`records_search`. Nhánh **server-orchestrated** (`agenticRetrieve`, đường chính
cho claude-cli/Ollama) thì **luôn tra KB**, không có bước quyết định "câu hỏi
này về dữ liệu bản ghi, không phải tài liệu". Với đa số tenant dùng bridge
→ chưa có định tuyến thật.

**Giải pháp:** thêm 1 bước **classify orchestrated** (1 lời gọi `callLlmJson`
rẻ) trước truy hồi, chạy cho MỌI adapter, phân loại ý định → định tuyến:

| target | nguồn | thực thi |
|---|---|---|
| `kb` | tài liệu/quy trình/văn bản | `agenticRetrieve` (như cũ) |
| `records` | số liệu/bản ghi 1 entity | `searchAgentRecords` (dữ liệu cấu trúc) |
| `web` | thông tin công khai ngoài cty | KB + `webFallback` (SearXNG) |
| `direct` | chào hỏi/giải thích chung | KHÔNG tra cứu (tiết kiệm token) |

### 11.1 Router contract (`callLlmJson`)
```ts
type RouteTarget = "kb" | "records" | "direct" | "web";
interface RouteDecision {
  targets: RouteTarget[];      // ≥1 (đa nguồn được); fail-safe = ["kb"]
  entity?: string;             // khi gồm "records" (đã validate allowlist)
  recordQuery?: string;        // từ khoá FTS records (thiếu → câu hỏi gốc)
  reason?: string;
}
```
- `routeQuery(db, companyId, userQuery, { entities, allowWeb, userId })` —
  feed danh sách entity `agentSearchable` (name + label) cho LLM để chọn ĐÚNG
  entity và **chặn route tới entity cấm**.
- `normalizeRoute(raw, { allowedEntities, allowWeb })` — hàm **THUẦN** (unit-test):
  lọc target hợp lệ; bỏ `web` nếu `!allowWeb`; bỏ `records` nếu entity ngoài
  allowlist; `direct` chỉ giữ khi là target DUY NHẤT; rỗng → `["kb"]`.

### 11.2 Bật/tắt (tôn trọng "rẻ mặc định")
- Cờ `smartRoute` (body `/agent/chat`) HOẶC `deepSearch` → bật router.
- **Không bật → mặc định `["kb"]`** = hành vi auto-RAG cũ, **0 lời gọi LLM
  thêm** (giữ Fast rẻ). Router là tier opt-in (1 call rẻ); nhánh `direct`
  còn *tiết kiệm* so với cũ (cũ luôn embed+search KB cả khi không cần).
- Toggle UI "Định tuyến" (I.GitBranch) cạnh "Tìm sâu" trong `AgentPanel`.

### 11.3 Bảo mật (BẮT BUỘC, fail-closed)
- Router chỉ thấy entity `agentSearchable=true` → KHÔNG route tới entity cấm.
- `searchAgentRecords` (helper mới `agent-records-search.ts`, **dùng chung**
  với tool `records_search` → 1 cổng bảo mật): deny-by-default
  `meta.agentSearchable` + field-level RBAC `stripUnreadableFields` + decrypt.
- Role-gate `view:entity` kiểm tại call-site (chỉ chạy nhánh records khi
  `canViewRecords`).

### 11.4 Fail-safe phân tầng
- `routeQuery` lỗi/null → `normalizeRoute(null)` → `["kb"]` (lùi auto-RAG cũ).
- Nhánh records lỗi/entity chưa opt-in → bỏ nhánh, KHÔNG vỡ chat (KB vẫn chạy).

### 11.5 File chạm
| File | Loại |
|---|---|
| `knowledge-agentic.ts` | + `routeQuery` / `normalizeRoute` / `preRoute` / types / `ROUTE_SYSTEM` |
| `agent-records-search.ts` (mới) | `searchAgentRecords` — tách từ tool, dùng chung; + `describeAgentEntity` / `sanitizeAgentFilters` (RBAC filter) |
| `index.ts` | router dispatch ở auto-RAG; cờ `smartRoute`; tool `records_search` gọi helper |
| `AgentPanel.tsx` | state + body `smartRoute` + toggle "Định tuyến" |
| `knowledge-agentic.test.ts` | unit test `normalizeRoute` (9 ca) |

### 11.6 Mở rộng (✅ XONG 2026-06-26 — cả 3 mục)
- ✅ **Heuristic pre-router (không LLM)** — XONG (2026-06-26). `preRoute(query)`
  (`knowledge-agentic.ts`, hàm THUẦN): chuẩn hoá câu hỏi (bỏ dấu + hạ chữ +
  nuốt dấu câu) rồi khớp TRỌN câu với tập chào hỏi/cảm ơn/ack + vài pattern
  hỏi-về-trợ-lý → `["direct"]`; mơ hồ → `null`. Gọi ở 2 nơi: (a) đầu
  `routeQuery` → né 1 lời gọi LLM router cho ca hiển nhiên; (b) trong dispatch
  auto-RAG (`index.ts`) TRƯỚC gate `routeEnabled` → chào hỏi bỏ qua truy hồi
  NGAY CẢ ở chế độ Fast mặc định (tiết kiệm embedding + search KB), 0 LLM thêm.
  Fail-safe phân tầng: `null` → giữ nguyên hành vi cũ. Unit test 5 ca
  (`knowledge-agentic.test.ts`: chào hỏi/cảm ơn/meta → direct, câu hỏi thật +
  rỗng → null). Là bước hiện thực hoá "bật routing mặc định mà vẫn rẻ".
- ✅ **Router sinh `filters` cấu trúc cho records** — XONG (2026-06-26). Hai
  phần: (a) **bảo mật** — `sanitizeAgentFilters(fields, filters, role)` (hàm
  THUẦN, `agent-records-search.ts`) áp NGAY TRONG `searchAgentRecords` (cổng
  duy nhất) nên CẢ tool autonomous `records_search` LẪN routing đều bị chặn:
  bỏ filter trên field lạ / mã hoá / role-không-đọc-được (chống *filter-oracle*
  dò giá trị field cấm qua `>`/`<`) / op không hợp lệ. Đây cũng vá lỗ cũ (tool
  truyền filter LLM thẳng vào `buildRecordWhere` không kiểm field-RBAC). (b)
  **sinh filter** — `planRecordFilters(db, companyId, info, query, role)`
  (`knowledge-agentic.ts`): chế độ **Deep**, +1 lời gọi `callLlmJson` CHỈ trên
  nhánh đã route tới records (hiếm); chỉ phơi field role đọc được + không mã
  hoá; LLM rút điều kiện rõ (ngày/số tiền/trạng thái) thành `{op,value}`, phần
  còn lại để `q`. Helper `describeAgentEntity` resolve+gate+nạp-field dùng
  chung. Fail-safe: null → lùi về FTS `recordQuery`; output luôn được sanitize
  lại ở cổng. Unit test 7 ca `sanitizeAgentFilters`.
- ✅ **Telemetry `route.reason`** — XONG (2026-06-26). `logActivity(kind:"route")`
  ở dispatch auto-RAG (`index.ts`): ghi `targets` + `entity` + `reason` mỗi khi
  THỰC SỰ có quyết định định tuyến (pre-route heuristic hoặc LLM router chạy) —
  đường kb mặc định KHÔNG ghi (tránh nhiễu). Fire-and-forget, fail-safe (lỗi
  log không vỡ chat), company-scoped + `actorUserId`. KHÔNG thêm
  `retrieval_trace` (jsonb trên `agent_conversations`) — đúng quyết định §10-q4
  (hoãn cho tới khi cần audit sâu, tránh migration ở MVP); telemetry nhẹ qua
  `activity_log` (đã có) là đủ explainability per-tenant.
