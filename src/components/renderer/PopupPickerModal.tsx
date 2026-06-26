/* ==========================================================
   PopupPickerModal — Modal chọn / nhập dữ liệu được kích hoạt
   bởi ActionStep "open-popup".

   3 chế độ:
   - list   : Hiển thị bảng record, click hàng → trả về object
   - detail : Hiển thị chi tiết 1 record (theo recordId), "Chọn" → trả về
   - form   : Form trống, người dùng nhập, "Xác nhận" → trả về object
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { FileCell, ImageCell } from "@/components/renderer/FilePreviewModal";
import { Button, Input, Modal, SearchableSelect } from "@/components/ui";
import { normalizeVi } from "@/lib/text-utils";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionStepOpenPopup } from "@/types/page";

/** Tối đa dòng render trong bảng list — cap để DOM không lag khi tập kết quả lớn. */
const LIST_ROW_CAP = 200;

/** Ngưỡng bản ghi: nhỏ hơn → lọc client; lớn hơn → tìm server-side (debounce). */
const LOOKUP_THRESHOLD = 300;

/** Combobox cho 1 field lookup trong form popup.
 *  Tự quyết small/large: tải sẵn ≤LOOKUP_THRESHOLD → lọc client (zero re-fetch);
 *  entity lớn → gõ debounce 350ms → tìm server-side, huỷ request cũ khi gõ tiếp. */
function PopupLookupSelect({
  entity,
  valueField,
  labelField,
  value,
  onChange,
}: {
  entity: string;
  valueField: string;
  labelField: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [opts, setOpts] = useState<Array<{ value: string; label: string }>>([]);
  const [isLarge, setIsLarge] = useState(false);
  const [searching, setSearching] = useState(false);
  // term gõ — cập nhật đồng bộ (ô không lag); fetch chạy qua debounce 350ms
  const [q, setQ] = useState("");
  // Giữ preload để khôi phục khi q xoá trống (không fetch lại)
  const preloadRef = useRef<Array<{ value: string; label: string }>>([]);

  // Tải sẵn ban đầu: limit THRESHOLD+1 → quyết small/large
  useEffect(() => {
    let alive = true;
    api
      .getRecords(entity, { limit: LOOKUP_THRESHOLD + 1 })
      .then((res) => {
        if (!alive) return;
        const large = res.rows.length > LOOKUP_THRESHOLD;
        setIsLarge(large);
        const preload = (large ? res.rows.slice(0, LOOKUP_THRESHOLD) : res.rows)
          .map((r) => {
            const d = r.data as Record<string, unknown>;
            const val = d[valueField];
            const lbl = d[labelField];
            return {
              value: val == null ? "" : String(val),
              label: lbl == null ? String(val ?? "") : String(lbl),
            };
          })
          .filter((o) => o.value !== "")
          .sort((a, b) => a.label.localeCompare(b.label, "vi"));
        preloadRef.current = preload;
        setOpts(preload);
      })
      .catch(() => {
        if (alive) setOpts([]);
      });
    return () => {
      alive = false;
    };
  }, [entity, valueField, labelField]);

  // Server-search (chỉ khi entity lớn): debounce 350ms, huỷ request cũ khi gõ tiếp.
  useEffect(() => {
    if (!isLarge) return;
    const term = q.trim();
    if (!term) {
      // Xoá term → khôi phục preload, không cần fetch lại
      setOpts(preloadRef.current);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      setSearching(true);
      api
        .getRecords(entity, {
          filters: { [labelField]: { op: "contains", value: term } },
          limit: 40,
        })
        .then((res) => {
          if (!alive) return;
          setOpts(
            res.rows
              .map((r) => {
                const d = r.data as Record<string, unknown>;
                const val = d[valueField];
                const lbl = d[labelField];
                return {
                  value: val == null ? "" : String(val),
                  label: lbl == null ? String(val ?? "") : String(lbl),
                };
              })
              .filter((o) => o.value !== ""),
          );
          setSearching(false);
        })
        .catch(() => {
          if (alive) setSearching(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, isLarge, entity, valueField, labelField]);

  return (
    <SearchableSelect
      className="w-full"
      value={value}
      onChange={onChange}
      options={opts}
      emptyOption="— chọn —"
      onSearch={isLarge ? setQ : undefined}
      loading={isLarge ? searching : undefined}
    />
  );
}

const api = createApiDataSource("");

interface Props {
  step: ActionStepOpenPopup;
  recordId?: unknown;
  /** (list) Lọc server-side đã resolve: field → giá trị (op "="). */
  filters?: Record<string, unknown>;
  onSelect: (value: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function PopupPickerModal({ step, recordId, filters, onSelect, onCancel }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const entity = entities.find((e) => e.id === step.entity);

  const usableFields = (entity?.fields ?? []).filter(
    (f) => f.type !== "formula" && f.type !== "collection",
  );
  // step.fields → đúng tập + thứ tự đó; không có → tối đa 7 field đầu.
  // step.fieldOverrides → ghi đè type/label (vd url→file, text→image).
  const visibleFields = (
    step.fields && step.fields.length > 0
      ? (step.fields
          .map((n) => usableFields.find((f) => f.name === n))
          .filter(Boolean) as typeof usableFields)
      : usableFields.slice(0, 7)
  ).map((f) => {
    const ov = step.fieldOverrides?.[f.name];
    if (!ov) return f;
    return {
      ...f,
      ...(ov.type ? { type: ov.type } : {}),
      ...(ov.label ? { label: ov.label } : {}),
    };
  });

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  // Map field name → lookup config từ step — tra O(1) trong render (thay cho lookupOpts + effect)
  const lookupCfgByField = useMemo(
    () => Object.fromEntries((step.lookups ?? []).map((l) => [l.field, l])),
    [step.lookups],
  );
  // (list) Map nhãn cho cột lookup: { fieldName → { giá trị lưu → nhãn } }.
  const [listLabels, setListLabels] = useState<Record<string, Record<string, string>>>({});
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  // Dữ liệu record nạp sẵn cho form "Sửa" (có recordId). null = form thêm mới.
  const [formSeed, setFormSeed] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // (list multiSelect) tập id dòng đang chọn.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const multi = step.popupMode === "list" && step.multiSelect === true;
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Khoá ổn định cho filters (object đổi identity mỗi render) → tránh refetch loop.
  const filtersKey = JSON.stringify(filters ?? null);

  /* Fetch records (list) / record đơn (detail) / record nạp form sửa (form+recordId) */
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters dùng qua filtersKey (khoá JSON ổn định) thay vì object identity
  useEffect(() => {
    if (!step.entity) return;
    // Form THÊM mới (không recordId) → không fetch; effect init rỗng bên dưới lo.
    if (step.popupMode === "form" && recordId == null) return;

    if (step.popupMode === "list") {
      setLoading(true);
      // Lọc server-side theo filters (op "=") — vd chỉ sản phẩm cùng màu phiên bản.
      const f = filters
        ? Object.fromEntries(
            Object.entries(filters).map(([k, v]) => [k, { op: "=" as const, value: v }]),
          )
        : undefined;
      const sort = step.listSort
        ? { sort: { field: step.listSort.field, dir: step.listSort.dir ?? "asc" } }
        : {};
      api
        .getRecords(step.entity, { limit: 500, ...(f ? { filters: f } : {}), ...sort })
        .then((res) => setRows(res.rows.map((r) => ({ ...r.data, id: r.id }))))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
      return;
    } else if ((step.popupMode === "detail" || step.popupMode === "form") && recordId != null) {
      // Sửa: nạp record hiện tại → seed form (effect init bên dưới đổ vào input).
      setLoading(true);
      setDetailRow(null);
      setFormSeed(null);
      api
        .getRecord(String(recordId))
        .then((rec) => {
          const row = rec ? { ...(rec.data as Record<string, unknown>), id: rec.id } : null;
          if (step.popupMode === "detail") setDetailRow(row);
          else setFormSeed(row);
        })
        .catch(() => {
          setDetailRow(null);
          setFormSeed(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [step.entity, step.popupMode, recordId, filtersKey]);

  /* Khởi tạo form: rỗng (thêm mới) hoặc đổ từ formSeed (sửa). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chu y chi reset form khi doi popupMode/entity/seed, khong reset khi visibleFields thay doi de tranh xoa input dang nhap
  useEffect(() => {
    if (step.popupMode !== "form") return;
    const init: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = formSeed?.[f.name];
      init[f.name] = v == null ? "" : String(v);
    }
    setFormValues(init);
  }, [step.entity, step.popupMode, formSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  /* (list) Nạp nhãn cho cột lookup (vd bom_son_version_id → mã phiên bản). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi đổi popupMode/entity; step.listLookups ổn định theo lần mở popup
  useEffect(() => {
    const lks = step.listLookups ?? [];
    if (step.popupMode !== "list" || lks.length === 0) return;
    let alive = true;
    Promise.all(
      lks.map(async (lk) => {
        const vf = lk.valueField ?? "id";
        try {
          const res = await api.getRecords(lk.entity, { limit: 2000 });
          const map: Record<string, string> = {};
          for (const r of res.rows) {
            const d = r.data as Record<string, unknown>;
            const val = vf === "id" ? r.id : d[vf];
            const lbl = d[lk.labelField];
            if (val != null) map[String(val)] = lbl == null ? String(val) : String(lbl);
          }
          return [lk.field, map] as const;
        } catch {
          return [lk.field, {} as Record<string, string>] as const;
        }
      }),
    ).then((pairs) => {
      if (alive) setListLabels(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [step.popupMode, step.entity]);

  const onConfirmForm = async () => {
    const data: Record<string, unknown> = {};
    for (const f of visibleFields) {
      const raw = formValues[f.name] ?? "";
      if (f.type === "boolean" || f.type === "bool") data[f.name] = raw === "true";
      else if (f.type === "number" || f.type === "integer" || f.type === "currency") {
        data[f.name] = raw === "" ? null : Number(raw);
      } else {
        data[f.name] = raw;
      }
    }

    if (!step.persist) {
      onSelect(data);
      return;
    }

    setSaving(true);
    try {
      if (recordId != null) {
        await api.updateRecord(String(recordId), data);
        onSelect({ ...(formSeed ?? {}), ...data, id: recordId });
      } else {
        const created = await api.createRecord(step.entity, data);
        onSelect({ ...data, id: created.id });
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmMulti = () => {
    const ids = [...selected];
    const items = rows.filter((r) => ids.includes(String(r.id)));
    onSelect({ __many: true, ids, items });
  };

  const defaultTitle =
    step.popupMode === "list"
      ? `Chọn ${entity?.name ?? "bản ghi"}`
      : step.popupMode === "detail"
        ? `Chi tiết ${entity?.name ?? ""}`
        : `Nhập ${entity?.name ?? ""}`;
  const title = step.title || defaultTitle;

  // Precompute text bỏ-dấu 1 lần/row (gộp mọi visible field) — không normalize lại mỗi phím gõ.
  const rowNormIndex = useMemo(
    () => rows.map((r) => normalizeVi(visibleFields.map((f) => String(r[f.name] ?? "")).join(" "))),
    [rows, visibleFields],
  );
  // Defer search → lọc+render chạy nền, ô tìm không bị chặn khi table lớn.
  const deferredSearch = useDeferredValue(search);
  const filteredRows = useMemo(() => {
    if (!deferredSearch) return rows;
    const q = normalizeVi(deferredSearch);
    return rows.filter((_, i) => (rowNormIndex[i] ?? "").includes(q));
  }, [rows, rowNormIndex, deferredSearch]);
  // Chỉ render tối đa LIST_ROW_CAP dòng — bảng lớn không vẽ hết vào DOM.
  const shownRows =
    filteredRows.length > LIST_ROW_CAP ? filteredRows.slice(0, LIST_ROW_CAP) : filteredRows;
  const tableOverflow = filteredRows.length - shownRows.length;

  // Form rộng hơn để chứa 2 cột trên màn lớn; list 760; detail 520.
  // Modal cap theo viewport (w-full + maxWidth) nên màn nhỏ tự co lại.
  const modalWidth = step.popupMode === "list" ? 760 : step.popupMode === "form" ? 720 : 520;

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      width={modalWidth}
      footer={
        step.popupMode === "form" ? (
          <>
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={onConfirmForm} disabled={saving || loading}>
              {saving ? "Đang lưu..." : step.persist ? "Lưu" : "Xác nhận"}
            </Button>
          </>
        ) : step.popupMode === "detail" ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              disabled={!detailRow}
              onClick={() => detailRow && onSelect(detailRow)}
            >
              Chọn
            </Button>
          </>
        ) : multi ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button variant="primary" disabled={selected.size === 0} onClick={confirmMulti}>
              Áp dụng ({selected.size})
            </Button>
          </>
        ) : null
      }
    >
      {/* ── LIST ─────────────────────────────────────────────── */}
      {step.popupMode === "list" && (
        <div className="space-y-3">
          <div className="relative">
            <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm..."
              className="pl-7!"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">Không có dữ liệu</div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel-2 border-b border-border">
                    <tr>
                      {multi && (
                        <th className="w-9 px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Chọn tất cả"
                            checked={
                              filteredRows.length > 0 &&
                              filteredRows.every((r) => selected.has(String(r.id)))
                            }
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? new Set(filteredRows.map((r) => String(r.id)))
                                  : new Set(),
                              )
                            }
                          />
                        </th>
                      )}
                      {visibleFields.map((f) => (
                        <th
                          key={f.id}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap"
                        >
                          {f.label}
                        </th>
                      ))}
                      {!multi && <th className="w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row, i) => {
                      const rid = String(row.id);
                      const isSel = multi && selected.has(rid);
                      return (
                        <tr
                          // biome-ignore lint/suspicious/noArrayIndexKey: row la Record dong, khong dam bao co id on dinh; chi so hang la danh tinh hien thi
                          key={i}
                          className={`border-t border-border cursor-pointer group/row ${isSel ? "bg-accent/10" : "hover:bg-hover"}`}
                          onClick={() => (multi ? toggleSel(rid) : onSelect(row))}
                        >
                          {multi && (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label="Chọn dòng"
                                checked={isSel}
                                onChange={() => toggleSel(rid)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                          )}
                          {visibleFields.map((f) => {
                            const raw = String(row[f.name] ?? "");
                            const disp = listLabels[f.name]?.[raw] ?? raw;
                            return (
                              <td
                                key={f.id}
                                className="px-3 py-2 max-w-[180px] truncate"
                                title={disp}
                              >
                                {disp}
                              </td>
                            );
                          })}
                          {!multi && (
                            <td className="pr-2 text-right">
                              <span className="text-[10px] text-accent opacity-0 group-hover/row:opacity-100">
                                Chọn →
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {tableOverflow > 0 && (
                      <tr>
                        <td
                          colSpan={visibleFields.length + (multi ? 1 : 0) + (!multi ? 1 : 0)}
                          className="px-3 py-1.5 text-xs text-muted/70 italic border-t border-border/50"
                        >
                          Còn {tableOverflow} dòng — gõ thêm để thu hẹp…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-1.5 text-[11px] text-muted border-t border-border bg-panel-2">
                {filteredRows.length} bản ghi
                {search && rows.length !== filteredRows.length && ` (${rows.length} tổng)`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL ───────────────────────────────────────────── */}
      {step.popupMode === "detail" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : !detailRow ? (
            <div className="text-center py-12 text-muted text-sm">Không tìm thấy bản ghi</div>
          ) : (
            <div className="divide-y divide-border">
              {visibleFields.map((f) => {
                const raw = detailRow[f.name];
                const s = raw == null ? "" : String(raw);
                let cell: ReactNode;
                if (
                  f.type === "image" &&
                  s &&
                  (s.startsWith("data:image/") ||
                    s.startsWith("/files/img/") ||
                    s.startsWith("/f/") ||
                    /^https?:\/\//.test(s))
                ) {
                  cell = (
                    <ImageCell url={s} className="h-16 max-w-[160px] object-contain rounded" />
                  );
                } else if (
                  f.type === "file" &&
                  (s.startsWith("/files/doc/") || s.startsWith("/f/"))
                ) {
                  cell = <FileCell url={s} />;
                } else {
                  cell = <span className="font-medium break-words">{s || "—"}</span>;
                }
                return (
                  <div key={f.id} className="grid grid-cols-[160px_1fr] gap-3 py-2.5 text-sm">
                    <span className="text-muted text-xs pt-0.5">{f.label}</span>
                    {cell}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FORM ─────────────────────────────────────────────── */}
      {step.popupMode === "form" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : visibleFields.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">Entity chưa có field nào</div>
          ) : (
            visibleFields.map((f) => (
              <div key={f.id} className="space-y-1">
                <label className="text-xs font-medium">
                  {f.label}
                  {f.required && <span className="text-danger ml-0.5">*</span>}
                </label>
                {f.type === "image" ? (
                  <div className="space-y-1.5">
                    {formValues[f.name] ? (
                      // biome-ignore lint/performance/noImgElement: ảnh base64/URL preview trong modal, không cần tối ưu next/image
                      <img
                        src={formValues[f.name]}
                        alt=""
                        className="h-28 max-w-full object-contain rounded border border-border bg-panel-2"
                      />
                    ) : (
                      <div className="h-28 flex items-center justify-center text-xs text-muted border border-dashed border-border rounded">
                        No image data
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        className="text-xs"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () =>
                            setFormValues((v) => ({ ...v, [f.name]: String(reader.result) }));
                          reader.readAsDataURL(file);
                        }}
                      />
                      {formValues[f.name] && (
                        <button
                          type="button"
                          className="text-xs text-danger hover:underline"
                          onClick={() => setFormValues((v) => ({ ...v, [f.name]: "" }))}
                        >
                          Xoá ảnh
                        </button>
                      )}
                    </div>
                  </div>
                ) : lookupCfgByField[f.name]?.options?.length ? (
                  // Options tĩnh (value≠label) — không cần fetch
                  <SearchableSelect
                    className="w-full"
                    value={formValues[f.name] ?? ""}
                    onChange={(val) => setFormValues((v) => ({ ...v, [f.name]: val }))}
                    options={lookupCfgByField[f.name]?.options ?? []}
                    emptyOption="— chọn —"
                  />
                ) : lookupCfgByField[f.name]?.entity ? (
                  // Lookup từ entity: small → lọc client; large → tìm server-side debounce
                  <PopupLookupSelect
                    entity={lookupCfgByField[f.name]?.entity ?? ""}
                    valueField={lookupCfgByField[f.name]?.valueField ?? "id"}
                    labelField={lookupCfgByField[f.name]?.labelField ?? "id"}
                    value={formValues[f.name] ?? ""}
                    onChange={(val) => setFormValues((v) => ({ ...v, [f.name]: val }))}
                  />
                ) : f.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formValues[f.name] === "true"}
                      onChange={(e) =>
                        setFormValues((v) => ({
                          ...v,
                          [f.name]: e.target.checked ? "true" : "false",
                        }))
                      }
                    />
                    {f.label}
                    {f.required && <span className="text-danger ml-0.5">*</span>}
                  </label>
                ) : f.options && f.options.length > 0 ? (
                  <SearchableSelect
                    className="w-full"
                    value={formValues[f.name] ?? ""}
                    onChange={(val) => setFormValues((v) => ({ ...v, [f.name]: val }))}
                    options={f.options.map((opt) => ({ value: opt, label: opt }))}
                    emptyOption="— chọn —"
                  />
                ) : f.type === "text" || f.type === "longtext" ? (
                  <textarea
                    className="input w-full resize-none"
                    rows={f.type === "longtext" ? 3 : 1}
                    value={formValues[f.name] ?? ""}
                    onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    placeholder={f.label}
                  />
                ) : (
                  <Input
                    type={
                      f.type === "number" || f.type === "integer"
                        ? "number"
                        : f.type === "date"
                          ? "date"
                          : "text"
                    }
                    value={formValues[f.name] ?? ""}
                    onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    placeholder={f.label}
                  />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
