# Hướng dẫn vận hành Migration MSSQL

Tài liệu này mô tả toàn bộ quy trình chuyển đổi ứng dụng legacy MSSQL sang ERP
Framework, bao gồm cấu hình, từng bước trong UI, xử lý lỗi, và vận hành sau
khi chuyển giao.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Yêu cầu trước khi bắt đầu](#2-yêu-cầu-trước-khi-bắt-đầu)
3. [Cấu hình kết nối MSSQL](#3-cấu-hình-kết-nối-mssql)
4. [Quy trình 8 bước (từng tab)](#4-quy-trình-8-bước-từng-tab)
   - [Bước 1 — Discover (Khám phá)](#bước-1--discover-khám-phá)
   - [Bước 2 — Diagram (Sơ đồ)](#bước-2--diagram-sơ-đồ)
   - [Bước 3 — Enrich (Làm giàu)](#bước-3--enrich-làm-giàu)
   - [Bước 4 — Capture Golden (Chụp chuẩn vàng)](#bước-4--capture-golden-chụp-chuẩn-vàng)
   - [Bước 5 — Generate (Sinh code)](#bước-5--generate-sinh-code)
   - [Bước 6 — Data (Import dữ liệu)](#bước-6--data-import-dữ-liệu)
   - [Bước 7 — Review (Kiểm tra)](#bước-7--review-kiểm-tra)
   - [Bước 8 — Audit + Cutover (Kiểm toán + Chuyển giao)](#bước-8--audit--cutover-kiểm-toán--chuyển-giao)
5. [Phân loại Stored Procedure (Tier)](#5-phân-loại-stored-procedure-tier)
6. [Full Import — Import toàn bộ dữ liệu](#6-full-import--import-toàn-bộ-dữ-liệu)
7. [Xử lý sự cố thường gặp](#7-xử-lý-sự-cố-thường-gặp)
8. [Vận hành sau Cutover](#8-vận-hành-sau-cutover)

---

## 1. Tổng quan hệ thống

Migration MSSQL là một hệ thống **chuyển đổi từng module nghiệp vụ** từ ứng dụng
legacy SQL Server sang ERP Framework. Hệ thống không yêu cầu chuyển tất cả cùng
lúc — mỗi module (ví dụ: sales, inventory, HR) được xử lý độc lập theo đúng tiến
độ của doanh nghiệp.

```
MSSQL Legacy                    ERP Framework
─────────────────               ─────────────────────────────────
Tables          ──ETL──>        Entity Records (PostgreSQL)
Stored Procs    ──AI──>         Procedures JS/TS (Tier B/D)
Enum Tables     ──materialize─> Enums (bảng enums)
Schema/FK       ──codegen──>    Entity definitions, Page mẫu
```

**Kiến trúc nội bộ:**

| Thành phần | Vai trò |
|---|---|
| `settings/migration` (UI) | Giao diện điều khiển tất cả bước |
| `migration-router.ts` | 80+ tRPC endpoints quản lý manifest + job |
| `migration-worker.ts` | pg-boss worker xử lý job nền (discover/enrich/generate/...) |
| `migration-full-import.ts` | Engine streaming ETL với auto-resume |
| `mssql-connections-router.ts` | CRUD kết nối MSSQL (mật khẩu mã hóa AES-256-GCM) |
| `packages/mssql-client/` | Driver wrapper + phân tích T-SQL heuristic |
| `tooling/migration-cli/` | CLI `pnpm migrate` cho automation/CI |
| `migration-plan/modules/*.yaml` | Single source of truth cho từng module |

**Dữ liệu tiến trình được lưu vào:**
- `migration-plan/modules/<module>.yaml` — manifest (Git-tracked)
- `migration-plan/decisions.yaml` — lịch sử quyết định cross-module
- Bảng DB: `migrationFullJobs`, `migrationFullJobTables` (auto-resume)

---

## 2. Yêu cầu trước khi bắt đầu

### 2.1 Phía server ERP

- Server đang chạy (`pnpm dev` hoặc production build)
- `ENCRYPTION_KEY` được đặt (dùng để mã hóa mật khẩu MSSQL)
- Biến môi trường LLM đã cấu hình (cần cho Enrich + Generate):
  - `ANTHROPIC_API_KEY` hoặc LLM profile trong Settings → AI
- Thư mục `migration-plan/` tồn tại ở gốc repo (tạo bằng `mkdir migration-plan/modules`)

### 2.2 Phía MSSQL Legacy

- Tài khoản DB **read-only** (SELECT trên tất cả bảng cần migrate)
- Nếu cần chạy **Capture Golden** (chụp output stored proc): thêm quyền EXECUTE, bật `allowWrite` trên kết nối
- Kết nối từ server ERP tới MSSQL phải thông (test trước bằng tab Connections)
- SQL Server 2012+ (cần `sys.dm_exec_procedure_stats` cho thống kê proc)

### 2.3 Quyền trong ERP

- Role **admin** trên công ty — tất cả migration endpoint yêu cầu `rbacProcedure("edit", "settings")`

---

## 3. Cấu hình kết nối MSSQL

Vào **Settings → Migrations → Connections** (hoặc `Settings → MSSQL Connections`).

### Tạo kết nối mới

| Trường | Ví dụ | Ghi chú |
|---|---|---|
| Tên | `ERP Legacy Production` | Tên hiển thị trong UI |
| Host | `192.168.1.100` | IP hoặc hostname SQL Server |
| Port | `1433` | Mặc định SQL Server |
| Database | `ErpLegacyDB` | Tên database nguồn |
| Username | `erp_readonly` | Service account |
| Password | `***` | Mã hóa AES-256-GCM, không lưu plain text |
| Encrypt | ✓ (bật nếu SQL Server dùng TLS) | |
| Trust Server Cert | ✓ (bật cho môi trường dev/self-signed cert) | Tắt ở production nếu có CA hợp lệ |
| Allow Write | ✗ | Chỉ bật khi cần chạy Capture Golden |
| Đặt làm mặc định | ✓ | Kết nối mặc định dùng cho mọi thao tác migrate |

**Test kết nối** — nhấn nút "Test" sau khi lưu. Kết quả trả về số bảng đọc được.
Nếu lỗi, kiểm tra:
- Firewall giữa server ERP và SQL Server
- `trustServerCert` (thường cần bật trong môi trường nội bộ)
- Tài khoản có quyền `SELECT` trên schema `dbo`

---

## 4. Quy trình 8 bước (từng tab)

Vào **Settings → Migrations**. Thanh bên trái liệt kê các module đã tạo.
Mỗi module đi qua 8 tab theo thứ tự từ trái sang phải.

```
[Discover] → [Diagram] → [Enrich] → [Capture] → [Generate] → [Data] → [Review] → [Audit]
```

---

### Bước 1 — Discover (Khám phá)

**Mục đích**: Tự động quét MSSQL, xây dựng sơ đồ bảng + stored proc cho module.

**Thao tác:**

1. Nhấn **"Tạo module mới"** (hoặc chọn module chưa discover)
2. Điền thông tin:
   - **Tên module**: chữ thường, không dấu, không dấu cách (vd: `sales`, `inventory`)
   - **Seed tables**: danh sách 1–3 bảng trung tâm của module (vd: `dbo.Sales_Order,dbo.Sales_Item`)
   - **Exclude tables**: bảng cần bỏ qua (log, temp, archive cũ)
   - **Max tables**: giới hạn tổng số bảng (mặc định 30 — tăng cho module lớn)
3. Nhấn **"Chạy Discover"** → job chạy nền
4. Theo dõi tiến trình qua thanh trạng thái (WebSocket real-time)
5. Khi hoàn thành: manifest `migration-plan/modules/<module>.yaml` được tạo

**Kết quả**: Manifest chứa danh sách bảng + cột + FK + stored proc được tìm thấy qua BFS từ seed tables.

**Lưu ý:**
- BFS chỉ đi theo FK relations — nếu bỏ sót bảng quan trọng, thêm vào Seed Tables rồi chạy lại
- Bảng temp/log nên đặt vào Exclude Tables ngay từ đầu
- Sau discover, có thể **Refresh Manifest** bất kỳ lúc nào để đồng bộ schema MSSQL mới nhất (merge diff, không ghi đè quyết định đã có)

---

### Bước 2 — Diagram (Sơ đồ)

**Mục đích**: Visualize quan hệ giữa các bảng, xác nhận scope module là đúng.

**Thao tác:**
- Các node xanh = entity, node vàng = enum (theo `suggestedKind`)
- Edge = FK relation (đường mũi tên)
- Click node → xem chi tiết cột + FK
- Kéo thả để sắp xếp lại layout (tự động lưu vị trí)

**Kiểm tra cần làm:**
- Không có node "lạ" không thuộc module → thêm vào Exclude
- Bảng enum (danh sách cố định: trạng thái, loại) → đổi Kind thành `enum`
- Cross-module edge (relation sang bảng thuộc module khác) → bình thường, hệ thống xử lý tự động

---

### Bước 3 — Enrich (Làm giàu)

**Mục đích**: AI đặt tên tiếng Việt, mô tả, gợi ý tier cho từng bảng/stored proc.

**Thao tác:**

1. **Enrich tự động (batch)**: nhấn "Enrich toàn bộ" → job chạy nền
   - `maxCostUsd`: giới hạn chi phí LLM (mặc định $5/lần)
   - `skipEnriched`: bỏ qua những gì đã enrich → an toàn chạy lại
2. **Xem kết quả**: mỗi bảng/proc hiển thị label tiếng Việt + mô tả + tier gợi ý
3. **Chỉnh sửa thủ công**:
   - Đổi tên entity: dropdown "Đổi tên entity" → cascade tự động sang FK relations
   - Đổi kind: `entity` ↔ `enum` (cascade entityType trên các field FK)
   - Đổi tên field: "Đổi tên field" → cập nhật `mapTo.field`
4. **Normalize Names (AI)**: nhấn để AI đề xuất đổi tên hàng loạt cho nhất quán
   (vd: `orderId`, `orderNo`, `madon` → đồng nhất thành `orderId`)

**Lưu ý:**
- Mọi thay đổi được ghi vào `decisions.yaml` → tái sử dụng cho module sau
- File `.enriched.yaml` là bản AI-enriched; file gốc `.yaml` giữ nguyên để diff
- Enrich proc không bắt buộc cho tất cả — ưu tiên proc đang active (`active=true`)

---

### Bước 4 — Capture Golden (Chụp chuẩn vàng)

**Mục đích**: Chạy stored proc trên MSSQL thật, lưu output làm baseline kiểm tra sau migration.

> **Yêu cầu**: Kết nối MSSQL phải bật `allowWrite = true` (tạm thời).
> Tắt lại sau khi capture xong để về chế độ read-only.

**Thao tác:**

1. Chọn stored proc cần capture
2. Nhấn **"Sinh test cases (AI)"** → AI tạo 10 test case (happy path / boundary / edge)
   - Xem preview trước khi chạy
   - Sửa tham số nếu AI sinh sai
3. Nhấn **"Capture"** → thực thi proc trên MSSQL → lưu kết quả vào `e2e/golden/<module>/<proc>.json`
4. Xem kết quả: số case thành công / thất bại

**File baseline:**
```json
{
  "procName": "dbo.sp_GetOrderDetails",
  "capturedAt": "2026-01-15T10:30:00Z",
  "cases": [
    {
      "name": "happy-path: orderId tồn tại",
      "kind": "happy",
      "input": { "OrderId": 12345 },
      "result": { "rows": [...], "returnValue": 0 }
    },
    {
      "name": "edge: orderId âm",
      "kind": "edge",
      "input": { "OrderId": -1 },
      "expectedError": true
    }
  ]
}
```

**Không bắt buộc** capture 100% proc — ưu tiên proc quan trọng (active, nhiều lần gọi).

---

### Bước 5 — Generate (Sinh code)

**Mục đích**: AI dịch T-SQL stored proc → JavaScript/TypeScript tương đương.

**Phân luồng theo Tier:**

| Tier | Loại proc | Output | Vị trí |
|---|---|---|---|
| **B** | Đọc dữ liệu + logic đơn giản | JS function | Bảng `procedures` (chạy qua procedure engine) |
| **D** | Logic phức tạp, external call, file | TS plugin | `packages/plugins/module-<name>/<file>.ts` |
| **A/C** | Quá phức tạp | Ghi chú + stub | Người dev tự viết tay |

**Thao tác:**

1. Chọn stored proc → tab **Generate**
2. Nhấn **"Xem trước (Dry-run)"** → AI sinh code, hiển thị diff, KHÔNG lưu
3. Xem code được sinh → chỉnh sửa nếu cần
4. Nhấn **"Áp dụng"**:
   - Tier B → upsert vào bảng `procedures` (tên proc + code JS)
   - Tier D → ghi file `.ts` vào `packages/plugins/module-<name>/`
5. Hoặc nhấn **"Generate tất cả"** → batch generate theo tier đã enrich

**Xử lý trường hợp AI sinh sai:**
- Xem T-SQL gốc qua nút "Xem T-SQL" → so sánh logic
- Sửa trực tiếp trong preview → Apply
- Đổi tier (vd: B → D) nếu logic quá phức tạp cho inline JS

---

### Bước 6 — Data (Import dữ liệu)

**Mục đích**: ETL dữ liệu từ bảng MSSQL vào `entity_records` PostgreSQL.

> Đây là bước di chuyển dữ liệu thật. Nên thực hiện trên môi trường staging trước.

**Có hai cách:**

#### Cách 1 — Quick Migrate (từng bảng, nhỏ)

Trong tab Data:
1. Chọn bảng cần migrate (checkbox)
2. Chọn **Limit** (mặc định không giới hạn) hoặc để test với 100 rows
3. Nhấn **"Migrate"** → chạy đồng bộ, hiển thị kết quả ngay

#### Cách 2 — Full Import Job (lớn, có auto-resume)

Vào **màn hình Full Import** (nút "Full Import" trên thanh trên):
1. Chọn kết nối MSSQL
2. Chọn bảng cần import (có thể chọn tất cả)
3. Cấu hình:
   - **Batch size**: 1000 (mặc định) — tăng lên 5000 nếu network tốt
   - **Ghi đè**: bật nếu muốn re-import kể cả đã tồn tại
4. Nhấn **"Bắt đầu Import"**

→ Xem chi tiết tại [Mục 6: Full Import](#6-full-import--import-toàn-bộ-dữ-liệu).

---

### Bước 7 — Review (Kiểm tra)

**Mục đích**: Tổng hợp tiến độ module trước khi audit chính thức.

**Dashboard hiển thị:**

| Chỉ số | Ý nghĩa | Mục tiêu |
|---|---|---|
| % Enriched | Tỷ lệ bảng/proc đã có label + mô tả | ≥ 80% |
| % Codegen | Tỷ lệ proc đã sinh code (tier B/D) | ≥ 70% active procs |
| % Golden | Tỷ lệ proc đã capture baseline | ≥ 60% active procs |
| % Enum | Tỷ lệ bảng enum đã materialize | 100% |
| Data migrated | Bảng đã ETL / tổng bảng | Tùy yêu cầu |

**Kiểm tra từng bảng:**
- Màu xanh = done, vàng = partial, đỏ = missing
- Click vào bảng → xem chi tiết cột, FK, trạng thái

---

### Bước 8 — Audit + Cutover (Kiểm toán + Chuyển giao)

**Mục đích**: AI tổng hợp checklist kiểm tra cuối, xác nhận module production-ready.

**Thao tác:**

1. Tab **Audit** → nhấn **"Chạy Audit (Dry-run)"**
   - AI đọc manifest + T-SQL + code sinh ra + golden baselines
   - Sinh markdown checklist: rủi ro, điểm cần kiểm tra, khuyến nghị
2. Xem markdown report → chỉnh sửa nếu cần
3. Nhấn **"Lưu báo cáo"** → lưu vào `migration-plan/audit/<module>.md`
4. Xem lại report → xác nhận tất cả checklist đã xử lý

**Cutover (Chuyển giao production):**

1. Đảm bảo:
   - Review score đạt ngưỡng (xem Bước 7)
   - E2E golden tests pass: `pnpm e2e:full --module <module>`
   - Audit report đã save + xem xét
2. Nhấn **"Finalize module"** → phase chuyển sang `live`, ghi `cutoverAt`
3. Thao tác phía MSSQL:
   - Đổi tên stored proc cũ: `EXEC sp_rename 'dbo.sp_GetOrder', 'dbo.sp_GetOrder_DEPRECATED'`
   - Theo dõi error log 7 ngày (nếu có call đến proc cũ → chưa migrate đủ)
4. Sau 7 ngày ổn định → có thể rollback finalize nếu cần: **"Unfinalize"**

---

## 5. Phân loại Stored Procedure (Tier)

Hệ thống dùng 4 tier để phân loại và xử lý stored proc:

```
Tier A — Người dev tự viết từ đầu
          Khi: logic quá phức tạp, AI không tạo được code chính xác
          Output: không có (dev tự code vào codebase)

Tier B — AI sinh → procedures table (chạy trong procedure engine)
          Khi: đọc dữ liệu, filter, join, tính toán cơ bản
          Output: JS function trong bảng `procedures`
          Ưu điểm: chỉnh sửa không cần deploy, multi-company

Tier C — Người dev viết, tham khảo AI suggest
          Khi: logic trung bình, AI sinh đúng ~70% nhưng cần chỉnh
          Output: dev tự code (thường là Tier B hoặc D sau khi sửa)

Tier D — AI sinh → TypeScript plugin file
          Khi: gọi external API, xử lý file, logic workflow phức tạp
          Output: packages/plugins/module-<name>/<file>.ts
          Cần: deploy lại sau khi thêm file mới
```

**Quy tắc chọn tier:**

| Đặc điểm proc | Tier gợi ý |
|---|---|
| Chỉ SELECT + JOIN + WHERE | B |
| Có INSERT/UPDATE nhưng logic đơn giản | B |
| Gọi stored proc khác (nested exec) | B hoặc D |
| Xử lý cursor, loop phức tạp | D |
| Gửi email, gọi HTTP, đọc file | D |
| Quá nhiều logic domain cụ thể | A (viết tay) |
| Transaction phức tạp + rollback | D hoặc A |

---

## 6. Full Import — Import toàn bộ dữ liệu

Full Import là cơ chế ETL chính cho dataset lớn (hàng triệu rows), với **auto-resume
sau server crash** và **streaming theo PK-order**.

### 6.1 Luồng hoạt động

```
Tạo job → prepareFullJobTables()
           ↓
           Detect PK từ MSSQL (1 cột, tự tăng)
           Resolve/tạo Entity tương ứng
           Ghi migrationFullJobTables records (status=pending)
           ↓
Worker nhận job → runFullImportJob()
           ↓
           Với mỗi bảng (status != done/failed):
             streamReadByPk(lastPk, batchSize=1000)
             ↓ mỗi batch:
             UPSERT entity_records (theo PK — tránh duplicate khi resume)
             Cập nhật lastPk + rowsImported
             Phát WebSocket { kind: "full-progress", ... }
           ↓
           Tổng hợp:
             allDone → status=completed
             someDone → status=paused
             else → status=failed
```

### 6.2 Auto-resume sau server restart

Khi server khởi động lại (`resumeStaleFullJobs`):
- Tìm jobs có status IN (`running`, `queued`, `paused`)
- Re-enqueue chúng vào pg-boss queue
- Worker tiếp tục từ `lastPk` đã lưu → **không bị duplicate, không mất dữ liệu**

**Đây là tính năng quan trọng** — có thể restart server bất kỳ lúc nào trong quá
trình import mà không lo mất tiến độ.

### 6.3 Theo dõi tiến trình

Vào **Settings → Migrations → Full Jobs** (nút ở thanh trên):

| Cột | Ý nghĩa |
|---|---|
| Status | queued / running / paused / completed / failed / canceled |
| Bảng | X/Y bảng hoàn thành |
| Rows | Tổng rows đã import |
| Last heartbeat | Lần cập nhật cuối (nếu > 5 phút = worker có thể bị treo) |

Click vào job → xem chi tiết từng bảng (rows, lastPk, status, lỗi nếu có).

### 6.4 Xử lý bảng không có PK đơn

Full Import yêu cầu **một cột PK duy nhất** để streaming. Nếu bảng có:
- **Không có PK**: thêm cột `id IDENTITY` vào MSSQL trước khi import
- **Composite PK (nhiều cột)**: sử dụng Quick Migrate (tab Data) với limit nhỏ, hoặc tạo view với row_number()
- **PK kiểu varchar**: hệ thống hỗ trợ — streaming theo thứ tự lexicographic

### 6.5 Pause và Resume thủ công

- **Pause**: nhấn "Dừng" trên job đang chạy → status = `paused`
- **Resume**: nhấn "Tiếp tục" → re-enqueue job → tiếp từ checkpoint
- **Cancel**: nhấn "Hủy" → status = `canceled` (không thể resume, phải tạo lại)

---

## 7. Xử lý sự cố thường gặp

### 7.1 Lỗi kết nối MSSQL

**Triệu chứng**: "Connect ECONNREFUSED" hoặc "Login failed"

```
Kiểm tra:
1. Firewall: server ERP có reach được cổng 1433 SQL Server không?
   → ping từ server ERP: Test-NetConnection -ComputerName <host> -Port 1433

2. Cổng SQL Server đang lắng nghe?
   → Trên SQL Server: netstat -an | findstr 1433

3. SQL Server Browser đang chạy? (nếu dùng named instance)
   → Services.msc → SQL Server Browser → Start

4. trustServerCert:
   → Môi trường dev/self-signed cert: bật trustServerCert
   → Production với CA cert hợp lệ: tắt trustServerCert
```

### 7.2 Full Import bị treo (heartbeat không cập nhật)

**Triệu chứng**: Status = `running` nhưng `lastHeartbeat` > 5 phút trước

```
Nguyên nhân thường gặp:
1. Query MSSQL bị lock (long-running transaction bên MSSQL)
   → Kiểm tra: EXEC sp_who2 → tìm blocking sessions
   → Kill blocking SPID nếu cần

2. Network timeout giữa server ERP và MSSQL
   → requestTimeoutMs = 120s (full-import) — nếu bảng > 1M rows với index chậm,
     batchSize nhỏ lại (500 thay vì 1000)

3. Server ERP bị restart đột ngột
   → Restart server → auto-resume bắt đầu ngay khi boot

Xử lý:
- Restart server ERP → job tự resume
- Hoặc: nhấn "Pause" → "Resume" để trigger re-queue
```

### 7.3 Lỗi "Failed query: ... = ANY((...)::text[])"

**Nguyên nhân**: Drizzle ORM expand JS array không đúng cú pháp PostgreSQL.

**Trạng thái**: Đã sửa trong `migration-full-import.ts` (dùng `inArray` thay `ANY`).
Nếu gặp lại ở chỗ khác: thay `sql\`expr = ANY(${arr}::text[])\`` bằng
`inArray(expr, arr)` từ `drizzle-orm`.

### 7.4 Discover bị timeout hoặc quét quá nhiều bảng

**Triệu chứng**: Job chạy > 5 phút, hoặc manifest có 200+ bảng không liên quan

```
Nguyên nhân: BFS không có giới hạn scope tốt
Xử lý:
1. Giảm maxTables (vd: 20 thay vì 30)
2. Thêm bảng "cầu nối" không liên quan vào excludeTables
3. Chọn seed tables chính xác hơn (bảng TRUNG TÂM, không phải bảng lookup)
4. Sau discover: dùng "Loại trừ bảng" trong UI để bỏ bảng không cần
```

### 7.5 Enrich AI sinh nhãn sai hoặc tier sai

```
Xử lý:
- Sửa label/description thủ công trong tab Enrich
- Đổi tier: chọn proc → "Đổi tier" dropdown
- Chạy lại enrich cho proc cụ thể (không phải toàn bộ):
  nút "Enrich riêng proc này" → dry-run trước → apply
```

### 7.6 Generate sinh code JS lỗi logic

```
Kiểm tra:
1. Xem T-SQL gốc (nút "Xem T-SQL") để hiểu logic thật
2. Dry-run lại → sửa trong preview editor → Apply
3. Nếu quá phức tạp: đổi sang Tier D hoặc Tier A
4. Golden test sẽ bắt lỗi logic: pnpm e2e:full --module <module>
```

### 7.7 Module bị "stuck" ở phase cũ sau khi xong

```
Phase tự động tăng khi:
- discovered → enriched: sau khi enrich xong ít nhất 1 bảng
- enriched → filled: sau khi generate proc hoặc migrate data
- filled → live: khi nhấn Finalize

Nếu phase không tự cập nhật:
- Kiểm tra manifest file: migration-plan/modules/<module>.yaml
- Cập nhật field status.phase thủ công nếu cần (hiếm gặp)
```

### 7.8 White screen / reload khi đang dùng migration UI

**Nguyên nhân**: Vite watch phát hiện file thay đổi trong `migration-plan/` khi
server ghi `decisions.yaml`.

**Trạng thái**: Đã sửa trong `vite.config.ts`:
```ts
server: { watch: { ignored: ["**/migration-plan/**"] } }
```
Cần **restart Vite dev server** (`Ctrl+C` → `pnpm dev`) để config có hiệu lực.

---

## 8. Vận hành sau Cutover

### 8.1 Monitoring 7 ngày đầu

Sau khi nhấn Finalize và đổi tên proc cũ sang `_DEPRECATED`:

```
Theo dõi hàng ngày:
1. SQL Server error log: có call đến proc DEPRECATED không?
   → EXEC sp_cycle_errorlog; SELECT * FROM sys.sysmessages WHERE ...

2. ERP application log: có lỗi liên quan đến module mới không?
   → Lọc level=error trong log viewer

3. User feedback: báo cáo anomaly từ người dùng portal/admin
```

### 8.2 Rollback nếu cần

Nếu phát hiện lỗi nghiêm trọng trong 7 ngày:

1. **Unfinalize module**: nút "Hủy finalize" trong tab Audit → phase về `filled`
2. **Khôi phục proc cũ**: đổi tên `_DEPRECATED` về tên gốc trên MSSQL
3. **Đổi route FE** về gọi proc MSSQL (nếu đã chuyển)
4. Điều tra lỗi → sửa code gen → Golden test lại → Finalize lại

### 8.3 Dọn dẹp sau migration hoàn thành

Sau khi tất cả module ổn định (≥ 30 ngày):

```
1. Xóa proc DEPRECATED trên MSSQL (backup DB trước)
2. Tắt kết nối MSSQL (Settings → Connections → Delete)
   - Giữ lại 1 kết nối read-only nếu cần tra cứu lịch sử
3. migration-plan/ vẫn giữ trong Git (audit trail)
4. Xóa hoặc archive packages/mssql-client/ nếu không dùng nữa
```

### 8.4 Thêm module mới sau khi đã live

Hệ thống hỗ trợ thêm module bất kỳ lúc nào:
- Module mới → **Bước 1 Discover** → quy trình bình thường
- Quyết định từ module cũ (`decisions.yaml`) tự động gợi ý cho module mới
- Entity đã migrate trước → `suggestedKind=entity` đã tồn tại → Enrich nhanh hơn

---

## Tài liệu liên quan

| File | Nội dung |
|---|---|
| `migration-plan/README.md` | Tổng quan CLI commands |
| `migration-plan/STYLE.md` | Quy ước đặt tên field + entity |
| `migration-plan/modules/_example.yaml` | Template manifest với chú thích đầy đủ |
| `migration-plan/decisions.yaml` | Lịch sử quyết định cross-module |
| `migration-plan/audit/<module>.md` | Báo cáo audit từng module |
| `docs/PROJECT-AUDIT-2026-05-25.md` | Audit tổng thể hệ thống |
