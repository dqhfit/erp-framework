/* Widget Detail + Form cho renderer: DetailWidget (render/sửa 1 record theo
   pageState) + CollectionSection (bảng con 1-N trong detail) + FormWidget (sinh
   form từ field, lưu record thật). Tách từ ConsumerPage.tsx (Phase A5) — chỉ di
   chuyển code, KHÔNG đổi hành vi. */
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { FileCell, ImageCell } from "@/components/renderer/FilePreviewModal";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import {
  api,
  DEFAULT_ROW_LIMIT,
  useEntity,
  usePageState,
  useWidgetData,
  useWidgetMeta,
} from "@/components/renderer/page-data";
import { Chip, SearchableSelect } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { applyFieldFormat } from "@/lib/format";

/** Phase V — DetailWidget: render 1 record theo state.
 *  Khi cfg.editable=true → render dạng form chỉnh sửa, lưu bằng updateRecord.
 *  Khi false (mặc định) → read-only. */
export function DetailWidget({ cfg, compId }: { cfg: Record<string, unknown>; compId?: string }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const recordIdFromState = cfg.recordIdFromState as string | undefined;
  const title = cfg.title as string | undefined;
  const editable = cfg.editable === true;
  const forwardRefs =
    (cfg.forwardRefs as Array<{ field: string; refEntityId: string }> | undefined) ?? [];
  const ent = useEntity(entityId);
  const { rows, fields: wdFields, isDataSource, update: dataUpdate } = useWidgetData(cfg);
  const pageState = usePageState();

  // Form state cho chế độ chỉnh sửa
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const submittingRef = useRef(false);

  const recordId = recordIdFromState ? pageState.get(recordIdFromState) : undefined;
  const record = rows.find((r) => r.id === recordId || String(r.id) === String(recordId));

  const allFields = isDataSource ? wdFields : (ent?.fields ?? []);
  const selectedFieldNames = (cfg.fields as string[] | undefined) ?? [];
  const allScalar = allFields.filter((f) => f.type !== "collection");
  const scalarFields =
    selectedFieldNames.length > 0
      ? allScalar.filter((f) => selectedFieldNames.includes(f.name))
      : allScalar;
  const collectionFields =
    selectedFieldNames.length > 0
      ? allFields.filter((f) => f.type === "collection" && selectedFieldNames.includes(f.name))
      : allFields.filter((f) => f.type === "collection");

  // V2 P5: mirror từng field ra pageState để widget khác filter theo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compId + record identity đủ
  useEffect(() => {
    if (!compId || !ent || !record) return;
    for (const f of allFields) {
      pageState.set(`detail:${compId}:${f.name}`, record[f.name]);
    }
  }, [compId, record?.id, ent?.id]);

  // Pre-fill form khi record thay đổi (editable mode)
  // biome-ignore lint/correctness/useExhaustiveDependencies: record.id + editable đủ để reset
  useEffect(() => {
    if (!editable) return;
    if (!record) {
      setForm({});
      return;
    }
    const filled: Record<string, string> = {};
    for (const f of scalarFields) {
      const v = record[f.name];
      filled[f.name] = v == null ? "" : String(v);
    }
    setForm(filled);
    setSaveMsg("");
    setSaveErr("");
  }, [record?.id, editable]);

  if (!entityId || !ent) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_detail")}</div>;
  }
  if (recordId == null || recordId === "") {
    return (
      <div className="p-4 text-xs text-muted h-full flex items-center justify-center text-center">
        <div>
          <I.Layout size={20} className="mx-auto mb-2 opacity-50" />
          Chọn 1 dòng ở danh sách để xem chi tiết.
        </div>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="p-3 text-xs text-muted">Không tìm thấy bản ghi (id={String(recordId)}).</div>
    );
  }

  const fwdSet = new Set(forwardRefs.map((r) => r.field));

  const save = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setSaveErr("");
    setSaveMsg("");
    try {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      if (isDataSource) await dataUpdate(String(record.id), data);
      else await api.updateRecord(String(record.id), data, record.version as number | undefined);
      setSaveMsg(t("widget.saved_ok"));
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const CollectionPart = () => (
    <>
      {collectionFields.map((f) => {
        const childEntityId = f.ref;
        const fkField = f.fkField;
        const parentId = record.id as string | undefined;
        if (!childEntityId || !fkField || !parentId) {
          return (
            <div
              key={f.name}
              className="p-2 rounded border border-warning/40 bg-warning/5 text-xs text-warning"
            >
              Collection "{f.label}" thiếu cấu hình (ref / fkField / parent id).
            </div>
          );
        }
        return (
          <CollectionSection
            key={f.name}
            label={f.label}
            parentId={parentId}
            childEntityId={childEntityId}
            fkField={fkField}
          />
        );
      })}
    </>
  );

  // ── Chế độ chỉnh sửa ────────────────────────────────────────────────────
  if (editable) {
    return (
      <div className="p-3 h-full overflow-auto space-y-2">
        {title && (
          <div className="text-sm font-semibold pb-1.5 border-b border-border">{title}</div>
        )}
        <div className="space-y-2">
          {scalarFields.length === 0 && (
            <div className="text-xs text-muted">{t("widget.no_fields")}</div>
          )}
          {scalarFields.map((f) => (
            <div key={f.name}>
              <label className="text-xs text-muted">
                {f.label}
                {f.required ? " *" : ""}
              </label>
              {f.type === "select" && f.options?.length ? (
                <SearchableSelect
                  className="w-full"
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  options={f.options.map((o) => ({ value: o, label: o }))}
                  emptyOption="— chọn —"
                />
              ) : (
                <input
                  className="input w-full"
                  type={
                    f.type === "number" || f.type === "currency"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "email"
                          ? "email"
                          : "text"
                  }
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t("common.saving") : t("widget.save_changes")}
          </button>
          {saveMsg && <span className="text-xs text-success">{saveMsg}</span>}
          {saveErr && <span className="text-xs text-danger">{saveErr}</span>}
        </div>
        <CollectionPart />
      </div>
    );
  }

  // ── Chế độ chỉ đọc (mặc định) ───────────────────────────────────────────
  return (
    <div className="p-3 h-full overflow-auto space-y-4">
      {title && (
        <div className="text-sm font-semibold mb-2 pb-1.5 border-b border-border">{title}</div>
      )}
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
        {scalarFields.map((f) => {
          const v = record[f.name];
          const isForward = fwdSet.has(f.name);
          return (
            <div key={f.name} className="contents">
              <dt className="text-muted truncate" title={f.label}>
                {f.label}
                {isForward && (
                  <Chip variant="accent" className="ml-1 text-[8px]!">
                    →
                  </Chip>
                )}
              </dt>
              <dd className="break-all">
                {(() => {
                  const s = v == null ? "" : String(v);
                  if (
                    f.type === "image" &&
                    s &&
                    (s.startsWith("data:image/") ||
                      s.startsWith("/files/img/") ||
                      s.startsWith("/f/") ||
                      /^https?:\/\//.test(s))
                  )
                    return (
                      <ImageCell url={s} className="h-14 max-w-[160px] object-contain rounded" />
                    );
                  if (f.type === "file" && (s.startsWith("/files/doc/") || s.startsWith("/f/"))) {
                    return <FileCell url={s} />;
                  }
                  return <span className="font-mono">{applyFieldFormat(f, v)}</span>;
                })()}
              </dd>
            </div>
          );
        })}
      </dl>
      <CollectionPart />
    </div>
  );
}

/** Phase V — CollectionSection: render danh sách record entity con (1-N)
 *  + CRUD inline (add / delete). Auto-filter theo fkField === parent.id. */
function CollectionSection({
  label,
  parentId,
  childEntityId,
  fkField,
}: {
  label: string;
  parentId: string;
  childEntityId: string;
  fkField: string;
}) {
  const childEnt = useEntity(childEntityId);
  const [rows, setRows] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey cố ý nằm trong deps để buộc reload thủ công sau khi thêm/sửa/xóa dòng con
  useEffect(() => {
    if (!childEntityId) return;
    let alive = true;
    setLoading(true);
    setErr("");
    api
      // Lọc khóa ngoại NGAY tại DB (trước limit) thay vì kéo 500 dòng rồi lọc
      // client — đúng khi entity con có >500 dòng tổng.
      .getRecords(childEntityId, {
        limit: DEFAULT_ROW_LIMIT,
        filters: { [fkField]: { op: "=", value: parentId } },
      })
      .then((res) => {
        if (!alive) return;
        // Lọc lại client-side phòng hờ (server đã lọc đúng fkField).
        const filtered = res.rows.filter((r) => {
          const v = (r.data as Record<string, unknown>)[fkField];
          return v === parentId || String(v) === String(parentId);
        });
        setRows(filtered.map((r) => ({ id: r.id, data: r.data as Record<string, unknown> })));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setErr((e as Error).message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [childEntityId, fkField, parentId, reloadKey]);

  if (!childEnt) {
    return (
      <div className="p-2 rounded border border-warning/40 bg-warning/5 text-xs text-warning">
        Collection "{label}" — không tìm thấy entity con (id={childEntityId}).
      </div>
    );
  }
  const childFields = (childEnt.fields ?? []).filter((f) => f.name !== fkField);
  const displayFields = childFields.slice(0, 5);

  const startAdd = () => {
    setAdding(true);
    setNewRow({});
  };
  const cancelAdd = () => {
    setAdding(false);
    setNewRow({});
  };
  const saveAdd = async () => {
    setSaving(true);
    setErr("");
    try {
      const data: Record<string, unknown> = { ...newRow, [fkField]: parentId };
      await api.createRecord(childEntityId, data);
      cancelAdd();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const removeRow = async (id: string) => {
    setDeletingId(id);
    setErr("");
    try {
      await api.deleteRecord(id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="border border-border rounded">
      <div className="px-3 py-1.5 border-b border-border bg-surface/40 flex items-center justify-between">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <I.Database size={11} className="text-accent" />
          {label}
          <Chip variant="default" className="text-[9px]!">
            {rows.length}
          </Chip>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={startAdd}
            className="text-[11px] text-accent hover:underline flex items-center gap-1"
          >
            <I.Plus size={11} /> Thêm
          </button>
        )}
      </div>
      {err && <div className="px-3 py-1 text-[10px] text-danger">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface text-muted">
            <tr>
              {displayFields.map((f) => (
                <th key={f.name} className="text-left px-2 py-1 font-medium">
                  <span className="flex flex-col leading-tight">
                    <span>{f.label}</span>
                    <span className="font-mono text-[9px] font-normal text-muted/60">{f.name}</span>
                  </span>
                </th>
              ))}
              <th className="w-12 px-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={displayFields.length + 1}
                  className="px-2 py-3 text-center text-muted text-[10px]"
                >
                  Đang tải...
                </td>
              </tr>
            ) : rows.length === 0 && !adding ? (
              <tr>
                <td
                  colSpan={displayFields.length + 1}
                  className="px-2 py-3 text-center text-muted text-[10px]"
                >
                  Chưa có record con.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  {displayFields.map((f) => (
                    <td key={f.name} className="px-2 py-1 truncate max-w-[200px]">
                      {applyFieldFormat(f, r.data[f.name])}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      disabled={deletingId === r.id}
                      className="text-muted hover:text-danger"
                      title="Xoá record con"
                    >
                      <I.X size={11} />
                    </button>
                  </td>
                </tr>
              ))
            )}
            {adding && (
              <tr className="border-t border-accent/40 bg-accent/5">
                {displayFields.map((f) => (
                  <td key={f.name} className="px-1 py-0.5">
                    <input
                      type="text"
                      value={(newRow[f.name] as string) ?? ""}
                      onChange={(e) => setNewRow((r) => ({ ...r, [f.name]: e.target.value }))}
                      placeholder={f.label}
                      className="w-full h-6 px-1 border border-border rounded bg-bg text-[10px]"
                    />
                  </td>
                ))}
                <td className="px-1 py-0.5">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={saveAdd}
                      disabled={saving}
                      className="text-success hover:bg-success/20 rounded px-1"
                      title="Lưu"
                    >
                      <I.Check size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelAdd}
                      disabled={saving}
                      className="text-muted hover:bg-hover/40 rounded px-1"
                      title="Huỷ"
                    >
                      <I.X size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Widget "form" — sinh form từ field của entity, lưu record thật. */
export function FormWidget({ cfg, compId }: { cfg: Record<string, unknown>; compId?: string }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const ent = useEntity(entityId);
  const { fields: wdFields, isDataSource, create: wdCreate } = useWidgetMeta(cfg);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const submittingRef = useRef(false);
  const linkedToState = cfg.linkedToState as { field: string; stateKey: string } | undefined;
  const emitLive = cfg.emitLiveFields === true;
  const pageState = usePageState();

  // V2 P5: debounced emit Form fields → pageState[`form:<id>:<f>`]
  // để widget khác có thể filter realtime theo input. Debounce 200ms tránh
  // spam setState mỗi keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: emit deps là form+compId+emitLive
  useEffect(() => {
    if (!emitLive || !compId) return;
    const t = setTimeout(() => {
      for (const [k, v] of Object.entries(form)) {
        pageState.set(`form:${compId}:${k}`, v);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [form, compId, emitLive]);

  if (!isDataSource && (!entityId || !ent)) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_form")}</div>;
  }
  const masterVal = linkedToState ? pageState.get(linkedToState.stateKey) : undefined;
  const hasMaster =
    !linkedToState || (masterVal !== undefined && masterVal !== null && masterVal !== "");
  const selectedFieldNames = (cfg.fields as string[] | undefined) ?? [];
  const sourceFields = isDataSource ? wdFields : (ent?.fields ?? []);
  const allFields =
    selectedFieldNames.length > 0
      ? sourceFields.filter((f) => selectedFieldNames.includes(f.name))
      : sourceFields;
  const fields = linkedToState?.field
    ? allFields.filter((f) => f.name !== linkedToState.field)
    : allFields;

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      // Bỏ field rỗng — server validate-on-write tự ép kiểu phần còn lại.
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      if (linkedToState && masterVal != null && masterVal !== "") {
        data[linkedToState.field] = masterVal;
      }
      await wdCreate(data);
      setForm({});
      setMsg(t("widget.saved_record"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-3 h-full overflow-auto">
      {cfg.title ? <div className="text-sm font-medium mb-2">{String(cfg.title)}</div> : null}
      {!hasMaster ? (
        <div className="p-4 text-xs text-muted flex flex-col items-center justify-center h-[calc(100%-2rem)] text-center gap-2">
          <I.Link size={18} className="opacity-40" />
          Chọn 1 dòng ở danh sách để thêm bản ghi liên quan.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.length === 0 && <div className="text-xs text-muted">{t("widget.no_fields")}</div>}
          {fields.map((f) => (
            <div key={f.id}>
              <label className="text-xs text-muted">
                {f.label}
                {f.required ? " *" : ""}
              </label>
              {(f.type === "lookup" || f.type === "multi-lookup") && f.ref ? (
                <LookupPicker
                  refEntityId={f.ref}
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  multi={f.type === "multi-lookup"}
                />
              ) : f.type === "select" && f.options?.length ? (
                <SearchableSelect
                  className="w-full"
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  options={f.options.map((o) => ({ value: o, label: o }))}
                  emptyOption="— chọn —"
                />
              ) : f.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={form[f.name] === "true"}
                    onChange={(e) =>
                      setForm({ ...form, [f.name]: e.target.checked ? "true" : "false" })
                    }
                  />
                  {f.label}
                </label>
              ) : (
                <input
                  className="input w-full"
                  type={
                    f.type === "number" || f.type === "currency" || f.type === "integer"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "datetime"
                          ? "datetime-local"
                          : f.type === "email"
                            ? "email"
                            : "text"
                  }
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || fields.length === 0}
            onClick={() => void submit()}
          >
            {busy ? t("common.saving") : t("widget.save_record")}
          </button>
          {msg && <div className="text-xs text-success">{msg}</div>}
          {err && <div className="text-xs text-danger">{err}</div>}
        </div>
      )}
    </div>
  );
}
