# Plan: "Account Context" — auto-fill danh tính tài khoản (server-authoritative), thiết kế 1 lần

## Context — vì sao làm

Các form đề xuất (phôi, mua hàng, bảng màu, phiếu yêu cầu…) đang bắt user **tự chọn** "người đề xuất" + "bộ phận" — tốn thao tác, dễ sai, không ràng buộc ai là người đề xuất thật. Chỗ khác dùng token `$currentUser` resolve **ở client** (tên hiển thị) rồi gửi server → **giả mạo được qua API** và lưu **tên** thay vì username chuẩn.

**Mục tiêu:** Dựng **một "account context" đầy đủ** (mọi thông tin danh tính của tài khoản đăng nhập) làm nguồn chân lý. Form auto-fill + **khóa** (người đề xuất/bộ phận/chức vụ/người duyệt…), **server ghi đè khi lưu** (chống giả mạo), lưu đúng mã DQHF. Thiết kế generic **1 lần** để mọi form hiện tại + tương lai dùng chung, thay dần `$currentUser` client-side.

**Đã chốt:** Hướng **A — server-authoritative**; phạm vi **chuẩn hoá nhiều form**; thiết kế **trọn bộ metadata** (review lần này).

---

## Danh mục "Account Context" (toàn bộ field khả dụng)

Nguồn: `users` (account framework) + `companies` + hồ sơ DQHF `sys_user` (qua `users.legacy_username` → `sys_user.f_username`). `sys_user`/`tr_bophan` có `company_id` (scope đa-tenant).

| Field (context) | Nguồn | Chi phí | Dùng cho |
|---|---|---|---|
| `userId` | users.id | free | audit |
| `email` | users.email | free | liên hệ |
| `name` | users.name (= họ tên) | free | hiển thị |
| `role` | company_members.role (effective) | free (đã có) | RBAC |
| `companyId` | session active | free (đã có) | tenant |
| `legacyUsername` | users.legacy_username | **free** (thêm cột vào join sẵn) | **người tạo/đề xuất** |
| `companyName` | companies.name | +join nhẹ | hiển thị/in |
| `fullname` | sys_user.f_fullname | resolve | hiển thị (thường = name) |
| `employeeCode` | sys_user.f_employeecode | resolve | mã nhân viên |
| `departmentCode` | sys_user.f_departmentcode | resolve | **bộ phận (mã)** |
| `departmentName` | tr_bophan.f_tenbophan (join mã) | resolve | bộ phận (tên) |
| `position` | sys_user.f_position | resolve | chức vụ |
| `groupId` | sys_user.f_group_id | resolve | nhóm quyền DQHF |
| `managerUsername` | sys_user.f_managerid | resolve | **người duyệt mặc định** |
| `managerName` | sys_user(manager).f_fullname | resolve (self-join) | hiển thị người duyệt |

> **KHÔNG đưa vào**: `users.preferences` (lastPage/favorites = UI-state), `password_hash` (bí mật). `f_nhomdanhgia`/`f_nguoidanhgia` (đánh giá) — bỏ qua đợt này, thêm sau nếu cần (cùng cơ chế).

**Resolve toàn bộ field DQHF = 1 query** (1 lần/login ở me(); lazy ở write path):
```sql
SELECT su.f_fullname, su.f_employeecode, su.f_departmentcode, su.f_position,
       su.f_group_id, su.f_managerid, bp.f_tenbophan AS dept_name, mgr.f_fullname AS manager_name
FROM sys_user su
LEFT JOIN tr_bophan bp  ON lower(bp.f_mabophan)=lower(su.f_departmentcode) AND bp.company_id=su.company_id
LEFT JOIN sys_user mgr  ON lower(mgr.f_username)=lower(su.f_managerid)      AND mgr.company_id=su.company_id
WHERE su.company_id=${companyId} AND lower(su.f_username)=lower(${legacyUsername}) LIMIT 1
```

### Nguồn MỞ RỘNG (rà thêm — ngoài phạm vi đợt này, cùng cơ chế khi cần)
- **`sys_user.ext`** (jsonb): `chuky` (chữ ký số — hữu ích cho form ký duyệt), `active`, `board`, `customer_user`, `adminhangloi`, `admintieuchuan` (cờ admin theo module DQHF).
- **`hr_nhanvien_2`** (nối qua `employeeCode`=`f_manv`): hồ sơ HR phong phú — `f_ngaysinh`, `f_ngayvaolam`, `f_calamviec` (ca), `f_congdoan`/`f_tonhom` (tổ/nhóm SX), `f_machucvu`. Dùng nếu cần định tuyến theo tổ/ca.
- **`tr_nguoiduyet_bophan`** (`f_username` + `f_mabophan` + `f_phanloai`): **routing người duyệt theo bộ phận + loại đề xuất** — chính xác hơn `managerUsername`. Đây là cơ chế resolve "ai duyệt" theo `departmentCode` của user → để dành cho **luồng duyệt** (Phase sau), không thuộc account-context danh tính.
- Khác: `tr_nguoiduyet`, `tr_danhsach_xetduyet_user`, `tr_email_subscriber2` (duyệt/thông báo).

→ Bộ **core** (bảng chính ở trên) đủ cho auto-fill người đề xuất/bộ phận/chức vụ/người tạo. `chuky` + approver-routing là ứng viên Phase kế (ký + duyệt).

---

## Ảnh hưởng — trang bị tác động (đo trên DB local)

**Code dùng chung bị sửa**: `MasterDetailCreateModal` / `MasterDetailEditModal` (modal thêm/sửa master-detail), `records-router` (create/update), `me()`/`context`.

**6 trang dùng MasterDetail modal** (nhận code modal mới):
`de_xuat_phoi_2170cc` (đích), `de_xuat_bang_mau_8dd32d`, `de_xuat_mua_hang_10b9e3`, `danh_sach_don_dat_hang_9d5610`, `dq_p08_dinh_muc_cat_van`, `dq_p08_tao_yeu_cau_mua_hang_gva`.

**Mức ảnh hưởng = backward-compatible (0 đổi hành vi nếu không bật config):**
- **Token `$current*`**: chỉ kích hoạt khi page config DÙNG token → 5 trang còn lại không dùng → **không đổi**.
- **readonly→LookupPicker**: chỉ áp khi field **readonly VÀ có lookup**. Chỉ `de_xuat_bang_mau` có `readonlyFields` = `["ngaydexuat"]` (field **date, KHÔNG lookup**) → **không bị ảnh hưởng**. 4 trang kia không có readonlyFields.
- **records-router sessionFields**: chỉ chạy cho entity CÓ `meta.sessionFields` (opt-in) → hiện **0 entity** → không tác động tới create/update toàn hệ thống cho tới khi ta bật từng form.
- **`me()`/`context`**: toàn cục nhưng **additive** (mỗi login +1 query, +field) — không đổi hành vi.

**Kết luận**: triển khai phần code dùng chung **không làm vỡ** 5 trang kia; hành vi chỉ đổi ở trang/entity ta chủ động bật config. Cần **regression test 6 trang modal** (mở Thêm/Sửa lưu được), nhưng rủi ro thấp.

---

## Kiến trúc

- **Server là nguồn chân lý khi GHI**: `records.create`/`update` đọc `entities.meta.sessionFields` → **ghi đè** field danh tính từ account context (bỏ qua giá trị client). Generic theo entity, chống giả mạo.
- **Client chỉ HIỂN THỊ**: `me()` trả account context đầy đủ → modal điền sẵn (token) + **khóa** + hiển thị nhãn (fullname / tên bộ phận / tên người duyệt) qua `LookupPicker` readOnly.
- Cấu hình `sessionFields` ở **entity.meta** (server-trusted) — KHÔNG ở page config.
- 1 helper `loadAccountContext(db, user)` dùng chung cho me() + write-path.
- **Cache**: write-path gọi lại riêng (không reuse kết quả me() — khác request). Chấp nhận 1 query/create vì query nhẹ (3 bảng indexed). KHÔNG cache in-memory server (multi-worker, stale). Nếu cần tối ưu sau → Redis key `acc:<companyId>:<legacyUsername>` TTL 5m.

---

## Phase 1 — Session + me() trả account context

> **Tiên quyết**: Xác nhận cột `users.legacy_username` tồn tại — chạy `\d users` hoặc `SELECT legacy_username FROM users LIMIT 1`. Nếu chưa có → tạo migration thêm cột `legacy_username text` (nullable, không cần index riêng vì đã scope companyId).

**`packages/server/src/context.ts`**
- `SessionUser` (L16–28): thêm `legacyUsername: string | null`.
- `createContext()` SELECT (L72–75): thêm `legacyUsername: users.legacyUsername` (join sẵn → **0 query phát sinh**); gán vào `user` (L89). *(ctx.user giữ lean — chỉ thêm field free; phần DQHF resolve riêng.)*

**`packages/server/src/router-helpers.ts`** — helper dùng chung:
```ts
export type AccountContext = {
  userId, email, name, role, companyId, legacyUsername, companyName,
  fullname, employeeCode, departmentCode, departmentName,
  position, groupId, managerUsername, managerName: string | null
};
// 1 query join (sys_user + tr_bophan + manager), graceful null nếu thiếu bảng/legacyUsername.
export async function loadAccountContext(db, user): Promise<AccountContext> { ... }
// Lấy 1 nguồn cho sessionFields (đọc từ AccountContext đã load).
export function pickAccountField(acc, source): string | null { return acc[source] ?? null; }
```

**`packages/server/src/router.ts`** — `me` (L361): async, trả `{ ...ctx.user, account: await loadAccountContext(ctx.db, ctx.user) }` (hoặc spread phẳng các field). Chạy 1 lần/login.

---

## Phase 2 — Server-authoritative khi GHI (`entities.meta.sessionFields`)

**`packages/server/src/records-router.ts`**

Meta trên entity:
```json
{ "sessionFields": { "create": { "nguoidexuat":"legacyUsername", "bophan":"departmentCode", "nguoitao":"legacyUsername" },
                     "update": { "nguoisua":"legacyUsername" } } }
```
- **create** (L206–286): SAU `assertValid` (L240), TRƯỚC `store.insert` (L243) — `const acc = await loadAccountContext(db, ctx.user)`; với mỗi `{field: source}` trong `sessionFields.create` mà `hasField(field)` → `data[field] = pickAccountField(acc, source)`. **Ghi đè luôn** (khác create_by chỉ điền khi rỗng). Sau `stripUnwritableFields` → không vướng field-RBAC.
- **update** (L288–452): field trong `sessionFields.create` → **xoá khỏi data update** (bảo toàn người đề xuất/bộ phận gốc). `sessionFields.update` (vd `nguoisua`) → điền lúc update.
- Tái dùng `entity.meta` đã load trong handler (pattern `meta.bindings` ở `router-helpers.ts:763`). `loadAccountContext` chỉ chạy khi entity CÓ sessionFields (lazy, 1 query/create).

**Bật cho entity (JSONB MERGE — bài học CLAUDE.md #20):**
```sql
UPDATE entities SET meta = coalesce(meta,'{}'::jsonb) ||
  '{"sessionFields":{"create":{"nguoidexuat":"legacyUsername","bophan":"departmentCode"}}}'::jsonb
WHERE id='<entity-uuid>';
```
**Kiểm field thực tế từng entity** trước khi map (chỉ map field tồn tại):
- `tr_dexuat_phoi`: `nguoidexuat`+`bophan`.
- `tr_phieuyeucau_muahang`: `nguoiyeucau`+`bophan`.
- `tr_dexuat_bangmau`, `tr_phieuyeucau`: soi field rồi map (`nguoitao`/`bophan`…).

---

## Phase 3 — Client: token + khóa + hiển thị nhãn

**`src/stores/auth.ts`** — `AuthUser` (L19–28): thêm các field account context (`legacyUsername`, `departmentCode`, `departmentName`, `position`, `managerUsername`, `employeeCode`, `companyName`…). `me()` trả → tự vào store (L92).

**`src/components/renderer/MasterDetailCreateModal.tsx`**
- Import `useAuth`; `const acc = useAuth((s) => s.user)`.
- Khởi tạo master state (L209–217): mở rộng resolve token cạnh `__today__` — map token → field account:
  `$currentUsername`→`legacyUsername`, `$currentDept`→`departmentCode`, `$currentPosition`→`position`, `$currentManager`→`managerUsername`, `$currentEmployeeCode`→`employeeCode`, `$currentName`→`name`.
- `renderInput` readonly branch (L427–432): readonly + có `lookup` → render `LookupPicker` readOnly (tự resolve nhãn, kể cả ngoài preload — `LookupPicker.tsx:132–148, 244–250`); không lookup → `<div>{value||"—"}</div>`.

**`src/components/renderer/MasterDetailEditModal.tsx`** — readonly branch (L385–402): cùng cách (readonly + lookup → LookupPicker readOnly). Master nạp từ record → hiển thị giá trị gốc, khóa.

`CreateFormCfg.master`: `readonlyFields` + `defaultValues` đã có sẵn — không cần type mới.

---

## Phase 4 — Cấu hình form (entity meta + page config)

Mỗi form: (1) set `entity.meta.sessionFields.create`; (2) page config `createForm.master` + `editForm.master`:
- `readonlyFields: ["nguoidexuat","bophan"]`
- `createForm.master.defaultValues: { nguoidexuat:"$currentUsername", bophan:"$currentDept" }`
- giữ `fieldLookups` cho 2 field (readonly hiển thị nhãn).
- đẩy prod qua `tooling/migration-cli/src/sync-pages-to-prod.mjs`.

**Phôi**: page `2170ccb9-…`, entity `tr_dexuat_phoi` (`ca42397d-…`). Sau đó lặp cho mua hàng / bảng màu / phiếu yêu cầu.

---

## Phase 5 (nối tiếp, tùy chọn) — Retire `$currentUser` qua module-proc

Create qua proc (vd `trLenhcapphatCreate` nhận `nguoitao:"$currentUser"`) vẫn tin args client. Để authoritative trọn vẹn: mở rộng `ModuleProcFn` (`module-procs.ts`) truyền account context vào proc; cập nhật `procedures-router.ts` (invokeModule L220). **Mở rộng — không bắt buộc** cho form đề xuất (dùng `records.create`, đã phủ Phase 2). Duyệt-action (`nguoiduyet=$currentUser` qua `update-fields`) xử lý riêng (sessionFields.update hoặc dùng `managerUsername`).

**Khi nào làm Phase 5**: chỉ khi có form dùng `proc.invoke` (không phải `records.create`) cần chống giả mạo — hiện chưa có case cụ thể. **Không cần cho v1.** Deferred sang sprint sau.

---

## Files chạm

| Lớp | File | Việc |
|---|---|---|
| Session | `packages/server/src/context.ts` | SessionUser + SELECT `legacyUsername` |
| Helper | `packages/server/src/router-helpers.ts` | `AccountContext`, `loadAccountContext`, `pickAccountField` |
| me() | `packages/server/src/router.ts` | trả account context |
| Ghi | `packages/server/src/records-router.ts` | create override / update bảo toàn theo `meta.sessionFields` |
| Auth client | `src/stores/auth.ts` | `AuthUser` += field account context |
| Modal | `MasterDetailCreateModal.tsx` | token `$current*` + readonly→LookupPicker |
| Modal | `MasterDetailEditModal.tsx` | readonly→LookupPicker |
| Config DB | `entities.meta` (SQL merge) + page configs | bật từng entity/form |

Tái dùng: `LookupPicker` readOnly, pattern `create_by` (`records-router.ts:234–239`), đọc meta (`router-helpers.ts:763`), JSONB merge (`migration-sync-router.ts:538`).

### Thứ tự dependency

| Task | Phụ thuộc | Song song được với |
|---|---|---|
| Phase 1: context + me() + loadAccountContext | — | — |
| Phase 2: records-router sessionFields | Phase 1 (helper) | Phase 3 |
| Phase 3: client token + Modal | Phase 1 (AuthUser fields) | Phase 2 |
| Phase 4: config DB (entity meta + page) | Phase 1–3 deploy xong | — |
| Phase 5: module-proc | Phase 2 | Độc lập, defer |

---

## Verification

1. **Typecheck + lint** 0 error.
2. **UX local**: login tài khoản DQHF-migrated → Đề xuất phôi → Thêm → `nguoidexuat` hiện họ tên (khóa), `bophan` hiện tên bộ phận (khóa). Lưu → DB: `nguoidexuat=legacy_username`, `bophan=departmentCode`.
3. **Anti-spoof**: inject session test → `curl records.create` với `nguoidexuat="HACKER"` → DB ghi đè về username thật.
4. **Edit**: 2 field khóa, đúng giá trị gốc; sửa field khác → người/bộ phận không đổi.
5. **Multi-form**: lặp cho mua hàng/bảng màu/phiếu yêu cầu.
6. **Prod**: deploy code → set meta + đẩy page config → publish → kiểm tài khoản thật (Nguyễn Đính → BAOVE).

---

## Rủi ro / lưu ý
- Scope `company_id` mọi resolve (đa-tenant) — bắt buộc.
- **Account không có `legacy_username`** → `loadAccountContext` trả tất cả field DQHF = `null`; `pickAccountField` trả `null` → `sessionFields.create` bỏ qua field đó (không ghi đè), form vẫn lưu được, field để trống. **KHÔNG fallback sang `name`** — tránh lưu tên hiển thị thay vì mã DQHF.
- `me()` async + 1 query/login — chấp nhận; `legacyUsername` free.
- **Đẩy `entities.meta` lên prod**: dùng `migration_query_readonly` để soi trước, rồi chạy SQL merge qua MCP `migration_execute` (hoặc psql SSH). Xác nhận công cụ sẵn sàng trước rollout.
- **Rollback `sessionFields` nếu config sai**: `UPDATE entities SET meta = meta - 'sessionFields' WHERE id='<uuid>';` — hoặc patch key cụ thể: `jsonb_set(meta, '{sessionFields,create}', '{}')`.
- Code server là code mới → cần Coolify redeploy.
