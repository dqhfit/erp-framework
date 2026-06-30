# Rule: Convention code & test (erp-framework)

> Cheat-sheet ngắn. Nguồn chi tiết: `CLAUDE.md` (§3,7,8,9,12 + "Bài học từ session trước").

## Thang quyết định lean (CLAUDE.md §12) — dừng ở nấc ĐẦU áp dụng được
1. Có cần làm không (YAGNI)? → 2. Đã có trong codebase chưa (DataSource, `proc-table`,
`extractPageActions`, primitive `components/ui/`, `I.*`)? → 3. Stdlib/JS built-in? → 4. Native
nền tảng (React/Fastify/Postgres/Drizzle)? → 5. Dep đã cài? (không thêm dep mới nếu tránh được)
→ 6. 1 dòng? → 7. CHỈ KHI ĐÓ viết code tối thiểu chạy được.
- Sửa bug: trị GỐC (hàm dùng-chung 1 lần), không vá từng caller. Ưu tiên XOÁ hơn THÊM.

## TUYỆT ĐỐI KHÔNG lười (non-negotiable)
- Validate input ở trust boundary · error handling chống mất data · RBAC fail-closed + scope
  `company_id` · a11y · đúng chức năng được yêu cầu (đừng "tối giản" mất tính năng).

## Màu sáng/tối — token semantic (CLAUDE.md §7)
- CẤM màu palette cứng (`text-amber-500`, `bg-white`, `#hex`, `text-[#...]`) cho màu ngữ nghĩa.
- Dùng token: nền `bg-bg/bg-soft/panel/panel-2/hover`, chữ `text-text/muted`, viền `border-border`,
  nhấn `accent/accent-2`, trạng thái `success/warning/danger`. Opacity: `bg-accent/15`.
- Ngoại lệ (màu là DỮ LIỆU): Chart, swatch accent, preset nhóm, ErrorBoundary.

## UI/Frontend
- Primitive ở `src/components/ui/`; Modal/Drawer dùng `useFocusTrap`; icon thêm vào `Icons.tsx` (`I.*`).
- Form: react-hook-form + zod. Toast/dialog: `src/lib/dialog.ts` — KHÔNG native `alert/confirm/prompt`.
- TanStack `loc.search` là OBJECT → dùng `loc.href`, đừng concat string.

## Migration (CLAUDE.md §3)
- File `NNNN_<name>.sql` + entry `_journal.json`; timestamp `when` **unique tăng dần** (reuse =
  skip im lặng). Comment **ASCII-only**, không `/*` lồng. Idempotent (`IF EXISTS` + DO/EXCEPTION).
- ALTER/INDEX trên bảng nguồn `tr_*/dq_*` PHẢI bọc table-check (dev có thể chưa có bảng prod).
- Cột PG `date` khai báo Drizzle là `date(...)` không `timestamp`. postgres-js + JSONB: `sql.json(obj)`,
  KHÔNG `JSON.stringify`.

## Lint & Test
- Biome 2.4.x, `pnpm lint` = `biome check src`. CI **hard-fail 0 error** (warning không chặn).
  Autofix: `npx biome check src --write` (không `--unsafe`). Suppress: `// biome-ignore lint/<group>/<rule>: lý do`
  đúng vị trí (a11y cấp-element: dòng trên thẻ mở JSX). `useExhaustiveDependencies`: suppress, đừng đổi deps.
- Unit `*.test.ts` cạnh source (`pnpm test`). Bug fix kèm 1 test tái hiện. Chạy test + dán output
  trước khi báo "đã xong"; logic non-trivial để lại 1 check chạy được.

## Commit
- Prefix domain (`entity:|db:|sec:|perf:|ai:|ux:|a11y:|lint:|docs:|feat:|fix:|refactor:`), body
  tiếng Việt, kết `Co-Authored-By: <Claude>`. Xem skill `commit-helper`.
