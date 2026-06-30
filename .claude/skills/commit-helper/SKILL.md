---
name: commit-helper
description: Soạn commit message theo convention của repo erp-framework (prefix theo domain, body tiếng Việt, dòng Co-Authored-By Claude) từ thay đổi đang staged/working. Dùng khi muốn viết commit message, chuẩn hóa lịch sử commit. KHÔNG tự chạy git commit trừ khi được yêu cầu rõ.
---

# Commit Helper (theo convention erp-framework)

Soạn commit message bám đúng style repo (xem CLAUDE.md §3 "Commit style"). KHÁC Conventional
Commits chuẩn: prefix theo **domain**, body **tiếng Việt**, kết bằng dòng đồng tác giả Claude.

## Quy trình
1. Xem thay đổi: `git diff --staged` (nếu trống thì `git diff`).
2. Chọn **prefix domain** chính (không phải type tiếng Anh chung chung):
   `entity:` (low-code) · `db:` (schema/migration) · `sec:` · `perf:` · `ai:` · `ux:` ·
   `a11y:` · `lint:` · `docs:` · `feat:` · `fix:` · `refactor:`.
3. Viết **subject** ngắn, **tiếng Việt**, thì hiện tại, không dấu chấm cuối. Tránh subject
   tiếng Anh thuần (team Việt đọc).
4. Thay đổi không tầm thường → thêm **body** đa dòng giải thích *vì sao* (lý do/bối cảnh),
   không chỉ *cái gì*.
5. Có breaking change → footer `BREAKING CHANGE: ...`.
6. **Luôn** kết bằng dòng đồng tác giả:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Định dạng đầu ra
```
<prefix>: <subject tiếng Việt>

<body tiếng Việt — tuỳ chọn, giải thích lý do + bối cảnh, có thể đa dòng>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Nguyên tắc
- Một commit = một mục đích logic. Diff nhiều việc → gợi ý tách commit.
- KHÔNG tự `git commit` trừ khi người dùng yêu cầu rõ — chỉ đề xuất message.
- Migration: nếu diff đụng `packages/db/migrations/`, nhắc kiểm tra `_journal.json` (timestamp
  unique tăng dần) trước khi commit.
