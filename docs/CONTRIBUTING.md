# CONTRIBUTING — Cộng tác nhiều dev an toàn

> Mô hình: **trunk-based** (commit thẳng `main`) + kỷ luật `pull --rebase`.
> Mục tiêu: 2+ dev cùng sửa repo mà KHÔNG vỡ `main`, không xung đột câm.
> Đọc kèm `CLAUDE.md` (các "Bài học từ session trước").

## 1. Quy trình commit (thứ tự cứng)

```bash
git pull --rebase origin main      # đầu phiên + TRƯỚC mỗi push
# ... code, commit nhỏ, full-file ...
pnpm lint && pnpm -r typecheck     # pre-push hook cũng tự chạy (xem mục 4)
git push                           # reject (non-fast-forward)? -> pull --rebase -> push lại
```

- **Commit nhỏ, thường xuyên** → ít vùng đụng, rebase dễ.
- **Stage FULL file**, đừng partial-stage (`git add -p` từng đoạn): `lint-staged`
  format lại file lúc commit, partial-stage có thể **rớt nội dung**. Sau commit
  một phần, verify `git show HEAD:<file>`.
- **`pull --rebase`** (không merge) để giữ lịch sử tuyến tính. Có thể đặt mặc định:
  `git config pull.rebase true`.

## 2. Chia việc để ít đụng nhau

Monorepo có ranh giới gói rõ — chia theo gói/feature:
`packages/{core,db,server,client,plugins}` + `src/` (frontend).
Tránh 2 người cùng sửa file "nóng": `packages/server/src/index.ts`,
`packages/db/src/schema.ts`, `src/routeTree.gen.ts` (auto-gen, đã gitignore).

## 3. Điểm xung đột RIÊNG của repo (đọc kỹ)

| Hot-spot | Vì sao đau | Quy ước |
|---|---|---|
| **Migration** `packages/db/migrations/` + `migrations/meta/_journal.json` | 2 dev cùng tạo → trùng số `NNNN_` + conflict `_journal.json`; **trùng timestamp `when` → migration bị SKIP IM LẶNG** (drizzle dùng `when` để biết "đã apply") | Pull TRƯỚC khi tạo migration. Khi rebase: đổi **cả số file lẫn `when`** > max hiện tại. Chạy `pnpm check:journal` sau merge. |
| **pnpm-lock.yaml** | 2 dev đổi deps → conflict lockfile | 1 người đổi deps/lần. Conflict → `pnpm install` regenerate, **KHÔNG sửa tay**. Settings (overrides/minimumReleaseAge…) ở `pnpm-workspace.yaml` (pnpm 11). |
| **Biome format** | version lệch → diff format giả + CI đỏ | Dùng đúng `@biomejs/biome` trong devDeps (đừng cài global khác bản). |
| **File generated / WIP** | `src/routeTree.gen.ts` (gitignore), `migration-plan/ui/*.json`… float quanh | Thống nhất file nào commit / file nào ignore; đừng commit file sinh tự động. |
| **.env / secret** | gitignored, mỗi máy khác nhau | KHÔNG commit. Chia sẻ connection string/secret qua kênh an toàn, không qua git/chat chung. |

## 4. Lưới an toàn tự động

- **Pre-commit** (`.husky/pre-commit`): `lint-staged` format file `.ts/.tsx` staged.
- **Pre-push** (`.husky/pre-push`): chạy `check:journal` + `pnpm lint` +
  `pnpm -r typecheck` — chặn đẩy code làm đỏ CI. Bỏ qua (hiếm khi cần):
  `git push --no-verify`.
- **CI** (`.github/workflows/ci.yml`, chạy trên push `main` + mọi PR):
  - `check`: vite build → `pnpm -r typecheck` → `pnpm -r test` → `pnpm lint` (**hard-fail 0 error**).
  - `migration`: `check-journal.mjs`.
  - `e2e` + `e2e-full`.
  - ⚠ Trunk-based: CI chạy **sau khi** đã vào `main`. Pre-push là chốt chặn
    cục bộ TRƯỚC khi push — đừng `--no-verify` ẩu.

## 5. Quyền truy cập

- Mỗi dev một tài khoản GitHub có quyền **Write** trên repo (push bằng tài khoản
  không có quyền → `403`). Kiểm tra: `gh auth status`.
- Khuyến nghị tách credential rõ ràng (Git Credential Manager dễ kẹt nhầm
  tài khoản — logout/login lại nếu push 403 dù đã có quyền).

## 6. Branch protection (tùy chọn, hợp với trunk-based)

Trunk-based đẩy thẳng `main` nên KHÔNG bật "require PR". Nhưng nên bật vài
guard ở GitHub → Settings → Branches → Add rule cho `main`:

- ✅ **Require linear history** (ép rebase, cấm merge commit) — khớp `pull --rebase`.
- ✅ **Do not allow force pushes** + **Do not allow deletions** (chống ghi đè/xoá main).
- (Tùy) **Require status checks to pass** — nhưng cái này thực chất ép qua PR;
  nếu muốn gate CI cứng thì cân nhắc chuyển sang feature-branch + PR.

> Muốn gate CI cứng (không cho main đỏ) → đổi sang **feature branch + PR**
> (mỗi việc 1 nhánh `feat/*`, PR vào main, bật "Require status checks").
> Đây là nâng cấp khi trunk-based bắt đầu đụng nhiều.
