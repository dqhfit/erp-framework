# Kế hoạch chuyển đổi UI: DQHF WinForms → ERP Framework

> Lập 2026-06-11, sau khi hoàn tất re-migrate 130 bảng dữ liệu vào bảng thật
> (tên DB cũ, label tiếng Việt). Data layer đã sẵn — kế hoạch này là lớp UI.

## Bối cảnh & nguyên tắc

- **Data đã xong**: 130 entity = bảng thật PostgreSQL mang tên DB cũ
  (`tr_order_detail`, `tr_sanpham`…), cột typed, label tiếng Việt, COMMENT đầy đủ.
- **Nền UI đã có sẵn** (không phải xây mới):
  - PageDesigner + ConsumerPage renderer: widget list (bảng), form, detail,
    combobox/tagbox filter (`filterFromState`), master-detail, chart, html,
    tabs — đủ tái tạo pattern màn hình WinForms grid + form.
  - DataSource (ORM-like): join nhiều entity + write-back — thay cho các
    JOIN trong query của form DQHF.
  - Workflow designer (node llm/http/approval/foreach/subworkflow) — thay
    scheduled job + business flow.
  - Procedure (Tier B isolated-vm) + module-procs (Tier D plugin TS) +
    `codegen-proc` (Claude Agent SDK dịch T-SQL → TS, đã dùng cho pilot).
  - `dqhf-proc-scope.ts`: phân tích form C# → repo method → stored proc
    (mapping form ↔ procs đã giải được).
- **Nguyên tắc**: chuyển theo **module nghiệp vụ**, mỗi module đi trọn chu
  trình (UI + proc + nghiệm thu + cutover) rồi mới sang module kế — không
  chuyển nửa vời hàng loạt.

## Phase 0 — Kiểm kê form DQHF (1-2 ngày)

Mục tiêu: biết chính xác có bao nhiêu màn hình, thuộc module nào, màn nào
dùng nhiều.

1. Quét repo DQHF: liệt kê `*.Designer.cs` → form name + control tree
   (DataGridView, TextBox, ComboBox, Button…).
2. Chạy `dqhf-proc-scope` cho từng form → map form ↔ stored procs ↔ bảng
   (đã có sẵn logic, chỉ cần chạy batch + xuất báo cáo).
3. Xuất `migration-plan/ui-inventory.yaml`: mỗi form gồm
   `{form, module, controls: {grids, inputs, buttons}, procs[], tables[]}`.
4. Xếp hạng ưu tiên theo: tần suất dùng (hỏi user) × độ phức tạp (số control).

**Deliverable**: bảng kiểm kê + thứ tự chuyển đổi được user duyệt.

## Phase 1 — Pilot 1 module bằng tay (3-5 ngày)

Chọn module nhỏ đã quen: **mes_dinhmuc** (định mức gỗ ván — pilot data đã chạy).

1. Dựng page theo pattern chuẩn cho từng dạng màn WinForms:
   | Dạng màn DQHF | Pattern page ERP |
   |---|---|
   | Grid danh sách + tìm kiếm | widget `list` + combobox/tagbox `filterFromState` |
   | Grid + form chi tiết (master-detail) | `list` + `detail/form` với `emptyStateShowsAll=false` |
   | Form nhập liệu | widget `form` bind entity (bảng thật) |
   | Nút nghiệp vụ (tính toán, duyệt) | button → procedure (Tier B/D) hoặc workflow |
   | Báo cáo tổng hợp | DataSource join + widget `list`/`chart` |
2. Port procs của module: `codegen-proc` (Tier D) + capture-golden verify.
3. Nghiệm thu với user thật của màn đó — ghi lại mọi chỗ pattern thiếu
   (widget/tính năng cần bổ sung vào framework).

**Deliverable**: module pilot chạy được trên ERP + danh sách gap framework
+ định mức effort thật/màn (để ước lượng các module sau).

## Phase 2 — Bán tự động hoá scaffold (3-5 ngày, song song Phase 3)

Xây 2 lệnh CLI mới trong `tooling/migration-cli` (in-tree, theo convention):

1. **`analyze-form --module <m>`**: parse `*.Designer.cs` của module →
   trích control tree + data binding → ghi vào manifest
   (`tables[].formHints`, `forms[]` mới trong yaml). Tận dụng
   `dqhf-proc-scope` cho phần proc mapping.
2. **`scaffold-page --module <m> --form <f>`**: từ formHints + entity
   fields → sinh page JSON skeleton (list widget với đúng cột grid cũ,
   form với đúng field nhập, button gọi proc đã port) → POST
   `pages.save` (draft, chưa publish). Người dùng chỉ tinh chỉnh layout
   trong PageDesigner thay vì dựng từ đầu.
3. (Tuỳ chọn) bước AI: `callLlmJson` gợi ý layout/nhóm field từ control
   tree khi mapping cứng không đủ — fail-safe trả skeleton thô.

**Deliverable**: scaffold tự động ~70-80% page, người chỉnh 20-30% còn lại.

## Phase 3 — Chuyển đổi hàng loạt theo module (chiếm phần lớn thời gian)

Lặp cho từng module theo thứ tự ưu tiên từ Phase 0:

1. `analyze-form` + `scaffold-page` toàn bộ form module.
2. Port procs còn lại (Tier B qua procedures, Tier C qua workflow cron,
   Tier D qua codegen-proc + golden verify).
3. Tinh chỉnh page trong PageDesigner + gán RBAC (role nào thấy page nào).
4. Nghiệm thu user theo module — chạy SONG SONG với DQHF (data đã có
   delta-sync mirror nên 2 bên luôn khớp).
5. Ghi `status.phase` trong manifest module: `scaffolded → migrating → live`.

## Phase 4 — Cutover từng module

Điều kiện cutover mỗi module (gắn với hệ delta-sync đã có):
- [ ] Mọi form module có page ERP tương đương đã nghiệm thu
- [ ] Procs verify golden pass
- [ ] Delta-sync checklist xanh (no_error, low_lag, seeded, recent_sync)
- [ ] User module xác nhận ngày cắt

Thực hiện: `executeCutover` (mirror → live, ERP nhận ghi) → khoá form DQHF
tương ứng (ẩn menu/quyền) → theo dõi 1 tuần → rollback sẵn
(`rollbackCutover`) nếu sự cố.

## Việc cần làm TRƯỚC khi bắt đầu Phase 1

1. **Bật delta-sync** cho data mới import (quyết CT vs rescan — cần DBA
   hoặc dùng rescan không đụng MSSQL). Không có sync thì pilot chạy song
   song sẽ lệch data.
2. Gắn lại các page hiện có (nếu giữ) với entity mới sau đợt re-migrate.

## Ước lượng tổng

| Phase | Thời gian | Phụ thuộc |
|---|---|---|
| 0 — Kiểm kê | 1-2 ngày | repo DQHF |
| 1 — Pilot tay | 3-5 ngày | data sync chạy |
| 2 — Scaffold tool | 3-5 ngày | học từ Phase 1 |
| 3 — Hàng loạt | ~1-2 ngày/module nhỏ, 3-5 ngày/module lớn | Phase 2 |
| 4 — Cutover | nửa ngày/module + 1 tuần theo dõi | checklist sync |

## Rủi ro chính

- **Form phức tạp đặc thù** (báo cáo in, drag-drop, shortcut keyboard):
  pattern page không phủ được → cần page-widget plugin riêng
  (`packages/plugins/`, kind `page-widget`) — phát hiện sớm ở Phase 1.
- **Proc Tier D logic ngầm** (trigger, cursor): golden test bắt được sai
  lệch nhưng sửa tốn thời gian — ưu tiên proc đơn giản trước.
- **User quen WinForms**: giữ tên màn hình/label y hệt DQHF để giảm ma sát.
