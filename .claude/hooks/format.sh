#!/usr/bin/env bash
# Hook chạy sau khi Claude sửa file (PostToolUse, matcher Edit|Write).
# Được tham chiếu từ ../settings.json (key "hooks").
#
# TRẠNG THÁI: NO-OP an toàn. Mặc định KHÔNG làm gì để tránh chạy lệnh ngoài ý muốn.
# Khi muốn bật format tự động cho repo này (Biome), bỏ comment khối bên dưới.
#
# Claude Code truyền payload JSON qua STDIN, gồm đường dẫn file bị sửa.
# Tài liệu: https://docs.claude.com/claude-code/hooks

set -euo pipefail

# Đọc payload JSON từ STDIN.
payload="$(cat || true)"

# --- FORMAT BIOME CHO FILE VỪA SỬA (ĐÃ BẬT) -------------------------------
# Repo dùng Biome (package.json: "format": "biome format --write src").
# Chỉ format đúng file vừa Edit/Write (khỏi quét cả cây mỗi lần).
# - Chuẩn hóa "\" -> "/": payload Windows dùng backslash, Git Bash test -f +
#   biome cần forward-slash.
# - --files-ignore-unknown=true: bỏ qua file Biome không xử lý (.md/.sh/.sql...).
# - --no-errors-on-unmatched + "|| true": không bao giờ chặn Claude.
# - CHỈ format file trong src/ hoặc packages/ (tính theo path tương đối gốc repo).
file="$(printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input?.file_path||"").replace(/\\/g,"/"))}catch{}})' 2>/dev/null || true)"
if [ -n "${file:-}" ] && [ -f "$file" ]; then
  # Path tương đối so với gốc repo (xử lý cả path tuyệt đối lẫn tương đối).
  root="$(git rev-parse --show-toplevel 2>/dev/null | tr '\\' '/' || true)"
  rel="$file"; [ -n "$root" ] && rel="${file#"$root"/}"
  case "$rel" in
    src/*|packages/*)
      npx --no-install biome format --write --no-errors-on-unmatched --files-ignore-unknown=true "$file" >/dev/null 2>&1 || true
      ;;
  esac
fi
# ---------------------------------------------------------------------------

# Luôn thoát thành công để không chặn Claude (kể cả khi Biome bỏ qua file).
exit 0
