## Tóm tắt
<!-- 2-3 dòng mô tả thay đổi và lý do -->

## Loại thay đổi
- [ ] `feat` — tính năng mới
- [ ] `fix` — sửa bug
- [ ] `db` — migration schema
- [ ] `refactor` — không đổi hành vi
- [ ] `docs` / `chore`

## Migration DB
- [ ] Không có migration
- [ ] Có migration — đã chạy `pnpm check:journal` ✓

## Test plan
<!-- Mô tả cách đã test: thủ công / unit test / e2e -->

## Breaking change
- [ ] Không
- [ ] Có — impact và migration path:

## Checklist
- [ ] `pnpm -r typecheck` pass
- [ ] `pnpm test` pass
- [ ] `pnpm check:journal` pass (nếu có migration)
- [ ] Đã test thủ công golden path
