---
description: Nghiên cứu + lập kế hoạch cho một feature theo lát cắt dọc, trước khi viết code.
argument-hint: <mô tả feature>
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git log:*)
---

Tôi muốn lập kế hoạch cho feature sau (CHƯA viết code — hãy nghiên cứu rồi đề xuất kế hoạch):

**Feature:** $ARGUMENTS

## Ngữ cảnh hiện tại
- Trạng thái repo: !`git status --short 2>/dev/null || echo "(không phải git repo)"`
- Quy ước project: @CLAUDE.md

## Yêu cầu với kế hoạch
1. **Nghiên cứu trước (ưu tiên codegraph)**: dùng `codegraph_context`/`codegraph_search`/
   `codegraph_impact` cho câu hỏi cấu trúc (ai gọi ai, định nghĩa ở đâu, blast radius) thay vì
   grep. Tìm helper/util/pattern đã có liên quan tới feature; nêu `file:line`. Ưu tiên TÁI SỬ
   DỤNG theo thang quyết định lean (CLAUDE.md §12), tránh viết mới khi đã có sẵn (DataSource,
   `proc-table`, primitive `components/ui/`, `I.*`...).
2. **Lát cắt dọc**: chia kế hoạch thành các bước chạy được end-to-end (tracer bullet:
   UI → tRPC → DB cho 1 use case), KHÔNG làm xong từng tầng ngang.
3. **Bảo mật/đa-tenant ngay từ đầu**: endpoint mutate data dùng `rbacProcedure`/`resourceProcedure`
   (không `protectedProcedure`); mọi lookup scope `company_id`; fail-closed.
4. Mỗi bước có **cách kiểm chứng**: `pnpm lint` (Biome, hard-fail 0 error), `pnpm test` (vitest),
   hoặc e2e khi cần. Bug fix kèm 1 test tái hiện.
5. Nêu rõ **file sẽ sửa** + rủi ro (blast radius). Migration mới: timestamp `_journal.json` unique
   tăng dần, comment ASCII, idempotent.
6. **Hỏi lại** nếu có điểm chưa rõ thay vì giả định.

Trình bày kế hoạch ngắn gọn, dễ quét, đủ chi tiết để thực thi.
