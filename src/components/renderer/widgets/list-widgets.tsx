/* Cụm List cho renderer (phần lõi, nặng nhất): EditableCell + RemoveNewRowButton
   + usePersistedDraft + EditableListWidget + ServerPagedListWidget + ListWidget +
   bindRowIdToAction. Dùng DataGrid/ExcelGrid + inline edit + batch + paste/export
   + persist draft (idb). Tách từ ConsumerPage.tsx (Phase A6) — chỉ di chuyển code,
   KHÔNG đổi hành vi. Chỉ ServerPagedListWidget + ListWidget export. */
import { useBlocker } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { exportCsvContentAsXlsx } from "@/components/renderer/consumer-utils";
import {
  type ColumnGroupNode,
  DataGrid,
  type ServerPagingController,
} from "@/components/renderer/DataGrid";
import { DrawingPageCell } from "@/components/renderer/DrawingPageCell";
import { fmtDateCell, fromDateInput, toDateInput } from "@/components/renderer/date-cell-utils";
import { ExcelGrid } from "@/components/renderer/ExcelGrid";
import { FileCell, ImageCell } from "@/components/renderer/FilePreviewModal";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import {
  type CreateFormCfg,
  MasterDetailCreateModal,
} from "@/components/renderer/MasterDetailCreateModal";
import { MasterDetailEditModal } from "@/components/renderer/MasterDetailEditModal";
import {
  api,
  useEntity,
  usePageState,
  useServerPagedRecords,
  useWidgetData,
} from "@/components/renderer/page-data";
import type {
  ActionBarItem,
  AggSpec,
  LoadFilters,
  RefFillResult,
  RowDetailCfg,
} from "@/components/renderer/page-types";
import { RowActionsCell } from "@/components/renderer/RowActionsCell";
import { Button, Modal, SearchableSelect } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { applyFieldFormat } from "@/lib/format";
import type { EntityField } from "@/lib/object-types";
import { applyFilters } from "@/lib/page-filters";
import { idbGet, idbSet } from "@/lib/page-state-idb";
import { fieldCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useRbac } from "@/stores/rbac";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, BindingValue, FilterNode } from "@/types/page";

/* ── Date/DateTime trong ô grid ──────────────────────────────────────────
   Giá trị lưu = chuỗi ISO (datetime, vd "2020-03-10T12:41:21Z") hoặc YYYY-MM-DD
   (date). Hiển thị gọn dd/MM/yyyy [HH:mm] theo giờ địa phương; sửa bằng input
   date / datetime-local; lưu lại ISO (datetime) / YYYY-MM-DD (date) để
   validate-on-write chuẩn hoá. Chuỗi KHÔNG parse được → giữ nguyên (không vỡ). */

/** Checkbox toggle ngay trên bảng — tự quản state cục bộ để flip tức thì
 *  không cần reload cả danh sách. Sync lại khi initialChecked đổi (server refetch). */
function BooleanCell({
  initialChecked,
  canWrite,
  onSave,
}: {
  initialChecked: boolean;
  canWrite: boolean;
  onSave: (val: boolean) => Promise<void>;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const [saving, setSaving] = useState(false);
  // Sync khi server refetch trả về giá trị mới.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cố ý chỉ sync theo initialChecked
  useEffect(() => {
    setChecked(initialChecked);
  }, [initialChecked]);
  return (
    <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!canWrite || saving}
        onChange={async () => {
          const next = !checked;
          setChecked(next);
          setSaving(true);
          try {
            await onSave(next);
          } catch (err) {
            setChecked(!next);
            dialog.alert(String(err));
          } finally {
            setSaving(false);
          }
        }}
        aria-label="Bật/tắt"
        className="accent-accent w-3.5 h-3.5 cursor-pointer disabled:cursor-default disabled:opacity-60"
      />
    </span>
  );
}

/** Ô sửa inline trong DataGrid: ảnh → <img>; date/datetime → format + picker;
 *  ref → lookup; còn lại text. Double-click ô có quyền ghi để sửa (Enter/blur
 *  lưu, Esc huỷ). Tự quản trạng thái edit cục bộ. */
function EditableCell({
  value,
  isImage,
  canWrite,
  onCommit,
  fieldType,
  refEntityId,
  refValueField,
  getLookupOptions,
}: {
  value: unknown;
  isImage: boolean;
  canWrite: boolean;
  onCommit: (v: string) => void;
  /** Loại field — "lookup"/"multi-lookup" thì ô sửa là dropdown chọn (ref). */
  fieldType?: string;
  /** Lookup theo GIÁ TRỊ field này (vd "nguyenlieu") thay vì record.id. */
  refValueField?: string;
  /** Entity đích của lookup (field.ref): có → chọn bản ghi entity đó. */
  refEntityId?: string;
  /** Lookup KHÔNG có entity đích → trả danh sách giá trị đang có của cột
   *  (faceted) để chọn "theo trường dữ liệu". Gọi lazy lúc vào sửa. */
  getLookupOptions?: () => string[];
}) {
  const [editing, setEditing] = useState(false);
  const str = value == null ? "" : String(value);
  const isDate = fieldType === "date" || fieldType === "datetime";
  const withTime = fieldType === "datetime";
  const isBoolean = fieldType === "boolean" || fieldType === "bool";
  const isNumber = fieldType === "number" || fieldType === "integer";
  const isLookup = fieldType === "lookup" || fieldType === "multi-lookup";
  if (
    isImage &&
    (str.startsWith("data:image/") ||
      str.startsWith("/files/img/") ||
      str.startsWith("/f/") ||
      /^https?:\/\//.test(str))
  ) {
    return <ImageCell url={str} className="h-6 max-w-[120px] object-contain mx-auto py-0.5" />;
  }
  // Bool: checkbox bấm thẳng (không cần double-click). stopPropagation để khỏi
  // chọn dòng. Chỉ ghi khi có quyền.
  if (isBoolean) {
    const checked = value === true || str === "true" || str === "1" || str.toLowerCase() === "có";
    return (
      <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!canWrite}
          onChange={(e) => onCommit(e.target.checked ? "true" : "false")}
          aria-label="Bật/tắt"
          className="accent-accent w-3.5 h-3.5 cursor-pointer disabled:cursor-default disabled:opacity-60"
        />
      </span>
    );
  }
  if (editing && canWrite) {
    if (isDate) {
      return (
        <input
          type={withTime ? "datetime-local" : "date"}
          defaultValue={toDateInput(str, withTime)}
          className="w-full px-1.5 py-0.5 outline outline-1 outline-accent text-xs bg-white dark:bg-bg"
          // biome-ignore lint/a11y/noAutofocus: con trỏ vào ô vừa double-click sửa
          autoFocus
          onBlur={(e) => {
            onCommit(fromDateInput(e.target.value, withTime));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      );
    }
    // Cột ref (nguyên liệu/veneer/UV/FSC…): mở thẳng ô chọn lookup. Có entity
    // đích → LookupPicker; không có (lookup "theo trường") → SearchableSelect
    // từ giá trị faceted của cột. autoOpen = nhấp đúp mở luôn; onClose = thoát.
    if (isLookup && refEntityId) {
      return (
        <LookupPicker
          refEntityId={refEntityId}
          value={str}
          valueField={refValueField}
          multi={fieldType === "multi-lookup"}
          className="w-full"
          autoOpen
          onClose={() => setEditing(false)}
          onChange={(v) => {
            onCommit(v);
            setEditing(false);
          }}
        />
      );
    }
    if (isLookup && getLookupOptions) {
      return (
        <SearchableSelect
          className="w-full"
          value={str}
          options={getLookupOptions().map((o) => ({ value: o, label: o }))}
          emptyOption="— chọn —"
          autoOpen
          onClose={() => setEditing(false)}
          onChange={(v) => {
            onCommit(v);
            setEditing(false);
          }}
        />
      );
    }
    return (
      <input
        type={isNumber ? "number" : "text"}
        inputMode={isNumber ? "decimal" : undefined}
        defaultValue={str}
        className="w-full px-1.5 py-0.5 outline outline-1 outline-accent text-xs bg-white dark:bg-bg"
        // biome-ignore lint/a11y/noAutofocus: con trỏ vào ô vừa double-click sửa
        autoFocus
        onBlur={(e) => {
          onCommit(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      // Marker để autofit (nhắp đúp viền cột) đo bề rộng CHỮ thật trong ô. Span
      // "block truncate" rộng đầy ô → nếu đo cả span sẽ ra đúng bề rộng HIỆN TẠI
      // (không co theo nội dung); DataGrid.measureCol ưu tiên đo node con này.
      data-col-content=""
      onDoubleClick={canWrite ? () => setEditing(true) : undefined}
      title={canWrite ? "Nhấn đúp để sửa" : "Không có quyền sửa cột này"}
      className={cn(
        // min-h: ô RỖNG vẫn phải có vùng cao để nhấp đúp. Span "block" rỗng cao
        // 0 → nhấp đúp trúng padding <td> (không có onDoubleClick) chứ không trúng
        // span → tưởng "không sửa được". Cho min-h = 1 dòng để luôn bấm trúng.
        "block truncate min-h-[1.25rem]",
        isNumber && "text-right tabular-nums",
        canWrite ? "cursor-text" : "opacity-70",
      )}
    >
      {isDate ? fmtDateCell(str, withTime) : str}
    </span>
  );
}

// ─── Batch-save dùng chung (client + server-paged) ───────────────────────────
type RowErr = { id: string; label: string; msg: string };
/** Khả năng bulk + dry-run validate — CHỈ entity-backed (datasource không có).
 *  Có thì "Lưu tất cả" đi đường: validate → confirm kèm kết quả → gom dòng cùng
 *  changeset → bulkUpdate/nhóm. */
interface BatchOps {
  validate: (
    items: Array<{ id: string; changes: Record<string, unknown> }>,
  ) => Promise<Array<{ id: string; ok: boolean; error?: string }>>;
  bulkUpdate: (
    ids: string[],
    patch: Record<string, unknown>,
  ) => Promise<{ updated: number; errors: Array<{ id: string; message: string }> }>;
}
/** Lưu hàng loạt pending. batchOps (entity): dry-run validate → confirm kèm kết
 *  quả → gom dòng cùng changeset y hệt → 1 bulkUpdate/nhóm. Else (datasource):
 *  confirm phạm vi → lưu tuần tự. Luôn GIỮ dòng lỗi để thử lại. */
async function runBatchSave(
  pending: Map<string, Record<string, string>>,
  rowLabel: (id: string) => string,
  ops: {
    batchOps?: BatchOps;
    onSaveRow: (id: unknown, changes: Record<string, unknown>) => Promise<void>;
  },
  t: (k: string, p?: Record<string, string | number>) => string,
): Promise<{ failed: Map<string, Record<string, string>>; errs: RowErr[]; cancelled: boolean }> {
  const entries = [...pending];
  const failed = new Map<string, Record<string, string>>();
  const errs: RowErr[] = [];
  if (ops.batchOps) {
    let results: Array<{ id: string; ok: boolean; error?: string }>;
    try {
      results = await ops.batchOps.validate(entries.map(([id, changes]) => ({ id, changes })));
    } catch (e) {
      return {
        failed: pending,
        errs: [{ id: "_", label: "", msg: (e as Error).message }],
        cancelled: false,
      };
    }
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    const invalid = results.filter((r) => !r.ok);
    const proceed = await dialog.confirm(
      invalid.length
        ? t("widget.bulk_confirm_bad", { ok: okIds.size, bad: invalid.length })
        : t("widget.bulk_confirm_ok", { ok: okIds.size }),
      { title: t("widget.bulk_title"), danger: invalid.length > 0 },
    );
    if (!proceed) return { failed: pending, errs: [], cancelled: true };
    for (const v of invalid) {
      failed.set(v.id, pending.get(v.id) ?? {});
      errs.push({ id: v.id, label: rowLabel(v.id), msg: v.error ?? t("widget.invalid") });
    }
    // Gom dòng hợp lệ theo changeset y hệt → 1 bulk/nhóm (lợi khi mass-set cùng giá trị).
    const groups = new Map<string, { patch: Record<string, string>; ids: string[] }>();
    for (const [id, changes] of entries) {
      if (!okIds.has(id)) continue;
      const sig = JSON.stringify(changes);
      const g = groups.get(sig) ?? { patch: changes, ids: [] };
      g.ids.push(id);
      groups.set(sig, g);
    }
    for (const g of groups.values()) {
      try {
        const r = await ops.batchOps.bulkUpdate(g.ids, g.patch);
        for (const e of r.errors ?? []) {
          failed.set(e.id, pending.get(e.id) ?? {});
          errs.push({ id: e.id, label: rowLabel(e.id), msg: e.message });
        }
      } catch (e) {
        for (const id of g.ids) {
          failed.set(id, pending.get(id) ?? {});
          errs.push({ id, label: rowLabel(id), msg: (e as Error).message });
        }
      }
    }
    return { failed, errs, cancelled: false };
  }
  // Datasource: confirm phạm vi → lưu tuần tự.
  const proceed = await dialog.confirm(t("widget.bulk_confirm_seq", { n: entries.length }), {
    title: t("widget.bulk_title"),
  });
  if (!proceed) return { failed: pending, errs: [], cancelled: true };
  for (const [id, changes] of entries) {
    try {
      await ops.onSaveRow(id, changes);
    } catch (e) {
      failed.set(id, changes);
      errs.push({ id, label: rowLabel(id), msg: (e as Error).message });
    }
  }
  return { failed, errs, cancelled: false };
}

/** Nút ✕ "Bỏ dòng mới này" — gỡ 1 dòng MỚI nháp (chưa lưu). Dùng trong cột hành
 *  động (khi lưới có) hoặc cột ✕ riêng (khi không có cột hành động). */
function RemoveNewRowButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      title="Bỏ dòng mới này"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="flex items-center justify-center w-5 h-5 rounded text-danger hover:bg-danger/10"
    >
      <I.X size={12} />
    </button>
  );
}

// ─── EditableListWidget — bảng chỉnh sửa inline (qua DataGrid xịn) ────────────

interface EditableListWidgetProps {
  ent: ReturnType<typeof useEntity>;
  title?: string;
  loading: boolean;
  err: string;
  filteredRows: Record<string, unknown>[];
  visibleFields: EntityField[];
  /** Override nhãn header theo cột (field name → nhãn). Ưu tiên hơn label entity. */
  columnLabels?: Record<string, string>;
  batchEdit: boolean;
  /** Giới hạn cột được sửa inline (field name). Rỗng/không set = TẤT CẢ cột (theo
   *  quyền field). Có set = CHỈ các field này thành ô sửa (vd combobox lookup),
   *  còn lại read-only — dùng cho lưới "chỉ hiển thị, riêng vài cột cho chọn". */
  editableFields?: string[];
  /** Tô nổi bật dòng có BẤT KỲ field nào trong danh sách bị rỗng (vd ["ma_ncc"]
   *  → dòng chưa chọn nhà cung cấp). */
  highlightEmptyFields?: string[];
  /** Cột tính client-side: field = tích các factor (vd thành tiền = sl_can × dongia).
   *  Khi sửa 1 factor → cập nhật overlay NGAY (không cần refetch). */
  computedColumns?: Array<{ field: string; product: string[] }>;
  /** Cột TÍNH read-only (không phải field entity). kind "percentDelta": hiện
   *  % chênh lệch (row[to] − row[from]) / row[from] × 100 (vd % tăng/giảm giá). */
  derivedColumns?: Array<{
    field: string;
    label?: string;
    kind: "percentDelta";
    from: string;
    to: string;
  }>;
  onSave: (rowId: unknown, changes: Record<string, unknown>) => Promise<void>;
  /** Bulk + dry-run validate (entity-backed) — ListWidget truyền khi không phải
   *  datasource. Có thì "Lưu tất cả" dùng validate→confirm→bulk thay tuần tự. */
  batchOps?: BatchOps;
  /** Chọn dòng (selectionStateKey) — click row set page-state, nút header
   *  (Xem chi tiết...) đọc theo. Double-click cell vẫn là sửa inline. */
  onRowClick?: (row: Record<string, unknown>) => void;
  isRowSelected?: (row: Record<string, unknown>) => boolean;
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Tạo dòng mới hàng loạt (dán). Có → bật chế độ thêm mới ở PasteGridModal. */
  onBulkCreate?: (records: Array<Record<string, string>>) => Promise<void>;
  /** Field cố định cho dòng tạo mới (vd masp = sản phẩm đang lọc). */
  createDefaults?: Record<string, string>;
  /** Khoá lưu trạng thái (IndexedDB) — dùng làm key nháp pending khi batchEdit. */
  stateKey?: string;
  /** Cột hành động theo dòng (Xem/Sửa/Xoá…) — render ActionWidget cho từng dòng. */
  rowActions?: ActionConfig[];
  /** Bật chọn dòng (checkbox) — bật trong cài đặt list (mặc định ẩn). */
  selectable?: boolean;
  /** Key các nút bị ẩn trên popover hành động (cài đặt list). */
  rowActionsHidden?: string[];
  /** Kiểu cột hành động: "popover" (nút ⋯, mặc định) | "inline" (nút Xem/Sửa/Xoá). */
  rowActionsStyle?: "inline" | "popover";
  /** Datasource: đổi field ref → overlay cột projection (Tên VT…) từ master. */
  refFill?: (fieldName: string, value: string) => Promise<RefFillResult>;
  /** Bật DÒNG "＋ Thêm dòng mới" trong lưới (cfg.addRowAtEnd). Chỉ tác dụng khi
   *  batchEdit + onBulkCreate (mới có onAddRow). */
  addRowAtEnd?: boolean;
  /** Vị trí dòng thêm mới: đầu hay cuối lưới (cfg.addRowPos, mặc định "bottom"). */
  addRowPos?: "top" | "bottom";
  /** Nút hành động nhúng trong toolbar (cùng hàng, tương tự read-only mode). */
  embeddedActions?: ActionBarItem[];
  /** Override text khi lưới rỗng (vd hint "Chọn bộ lọc..." khi loadGate chưa mở). */
  emptyText?: string;
  /** loadGate chưa mở → bỏ qua DataGrid, render hint full-area (tránh text lạc trong
   *  <td colSpan> bị overflow-x ẩn khi bảng nhiều cột). */
  gateClosed?: boolean;
}

/** Dòng MỚI nháp (chưa lưu): id tạm (`__new_*`) + vị trí chèn trên/dưới lưới.
 *  Giá trị ô của dòng mới nằm trong `pending` theo id tạm này. */
type NewRowDraft = { id: string; pos: "top" | "bottom" };

/** Overlay sửa-ô `pending` + dòng MỚI nháp `newRows`. Ở chế độ batchEdit TỰ LƯU
 *  NHÁP vào IndexedDB sau mỗi đổi → reload không mất trạng thái đang sửa/thêm;
 *  "Lưu tất cả" mới ghi DB (+ tạo dòng mới) rồi xoá nháp. enabled=false
 *  (tự-lưu-ngay) → KHÔNG persist. */
function usePersistedDraft(draftKey: string | undefined, enabled: boolean) {
  const [pending, setPending] = useState<Map<string, Record<string, string>>>(new Map());
  const [newRows, setNewRows] = useState<NewRowDraft[]>([]);
  const restored = useRef(false);
  // Nạp nháp MỘT lần khi mount — chỉ bật cờ persist SAU khi idbGet xong để
  // hiệu ứng ghi không đè nháp cũ bằng giá trị rỗng ban đầu.
  useEffect(() => {
    if (!enabled || !draftKey) {
      restored.current = true;
      return;
    }
    let alive = true;
    type Saved =
      | Array<[string, Record<string, string>]>
      | { pending?: Array<[string, Record<string, string>]>; newRows?: NewRowDraft[] };
    idbGet<Saved>(draftKey).then((saved) => {
      if (alive && saved) {
        // Tương thích cả format cũ (mảng entries) lẫn mới ({pending,newRows}).
        const p = Array.isArray(saved) ? saved : saved.pending;
        if (Array.isArray(p) && p.length > 0) setPending(new Map(p));
        const nr = Array.isArray(saved) ? null : saved.newRows;
        if (Array.isArray(nr) && nr.length > 0) setNewRows(nr);
      }
      restored.current = true;
    });
    return () => {
      alive = false;
    };
  }, [draftKey, enabled]);
  // Ghi nháp mỗi khi pending/newRows đổi (sau khi đã nạp + đang bật batchEdit).
  useEffect(() => {
    if (!enabled || !draftKey || !restored.current) return;
    void idbSet(draftKey, { pending: [...pending], newRows });
  }, [pending, newRows, draftKey, enabled]);
  return { pending, setPending, newRows, setNewRows };
}

function EditableListWidget({
  ent,
  title,
  loading,
  err,
  filteredRows,
  visibleFields,
  columnLabels,
  batchEdit,
  editableFields,
  highlightEmptyFields,
  computedColumns,
  derivedColumns,
  onSave,
  batchOps,
  onRowClick,
  isRowSelected,
  columnGroups,
  onBulkCreate,
  createDefaults,
  stateKey,
  rowActions,
  selectable,
  rowActionsHidden,
  rowActionsStyle,
  refFill,
  addRowAtEnd,
  addRowPos,
  embeddedActions,
  emptyText,
  gateClosed,
}: EditableListWidgetProps) {
  const t = useT();
  const pageState = usePageState();
  // Field-level RBAC cho inline edit — role + nhóm của user hiện tại.
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const { pending, setPending, newRows, setNewRows } = usePersistedDraft(
    stateKey ? `${stateKey}:editdraft` : undefined,
    !!batchEdit,
  );
  // Overlay HIỂN THỊ-ONLY cho cột projection (Tên VT…) khi đổi field ref —
  // KHÔNG đi vào `pending` (tránh ghi cột join read-only lên server).
  const [refOverlay, setRefOverlay] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Lỗi theo TỪNG dòng sau "Lưu tất cả" — [{ id, label, msg }].
  const [rowErrs, setRowErrs] = useState<Array<{ id: string; label: string; msg: string }>>([]);

  // Guard "pending chưa lưu": batchEdit còn ô sửa chưa lưu → chặn điều hướng
  // trong app (confirm) + reload/đóng tab (native prompt).
  const hasUnsaved = !!batchEdit && (pending.size > 0 || newRows.length > 0);
  useBlocker({
    shouldBlockFn: async () => {
      if (!hasUnsaved) return false;
      const leave = await dialog.confirm(t("widget.unsaved_leave", { count: pending.size }), {
        title: t("widget.unsaved_title"),
        danger: true,
      });
      return !leave;
    },
    enableBeforeUnload: () => hasUnsaved,
  });
  // Nhãn dòng để báo lỗi — giá trị field hiển thị đầu, else id rút gọn.
  const rowLabel = (rowId: string): string => {
    const r = filteredRows.find((x) => String(x.id) === rowId);
    const first = visibleFields[0]?.name;
    const v = r && first ? r[first] : undefined;
    return v != null && String(v).trim() ? String(v) : `#${rowId.slice(0, 8)}`;
  };

  // Lưu 1 ô: batch → gom pending; ngược lại lưu ngay. Pending cũng là overlay
  // hiển thị (ô vừa sửa thấy giá trị mới ngay, không chờ refetch). Ref để cell
  // renderer (trong columns memo) luôn gọi bản mới nhất mà không rebuild cột.
  const saveRef = useRef<(rowId: unknown, field: string, value: string) => void>(() => {});
  saveRef.current = (rowId, field, value) => {
    if (rowId == null) return;
    const rowIdStr = String(rowId);
    setPending((prev) => {
      const next = new Map(prev);
      const merged: Record<string, string> = { ...(next.get(rowIdStr) ?? {}), [field]: value };
      // Cột tính (vd thành tiền = sl_can × dongia): factor vừa đổi → tính lại NGAY
      // trên overlay (DB đã có cột generated tự đúng; đây chỉ để hiện tức thì).
      if (computedColumns?.length) {
        const row = filteredRows.find((r) => String(r.id) === rowIdStr) as
          | Record<string, unknown>
          | undefined;
        for (const cc of computedColumns) {
          if (!cc.product.includes(field)) continue;
          let prod = 1;
          let ok = true;
          for (const fac of cc.product) {
            const raw = fac in merged ? merged[fac] : row?.[fac];
            const n = Number(raw);
            if (raw == null || raw === "" || Number.isNaN(n)) {
              ok = false;
              break;
            }
            prod *= n;
          }
          if (ok) merged[cc.field] = String(prod);
        }
      }
      next.set(rowIdStr, merged);
      return next;
    });
    // Đổi field REF (mã vật tư…) → auto điền cột projection (Tên VT, Quy cách…)
    // từ record master vừa chọn — hiện NGAY (overlay), không chờ server re-join.
    if (refFill && visibleFields.find((f) => f.name === field)?.ref) {
      void refFill(field, value).then(({ overlay, snapshot }) => {
        if (Object.keys(overlay).length > 0) {
          setRefOverlay((prev) => {
            const next = new Map(prev);
            next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), ...overlay });
            return next;
          });
        }
        // NHẬT KÝ: cột base có snapshotFrom → ghi VÀO pending (sẽ LƯU) để đóng
        // băng giá trị ref tại thời điểm chọn. Non-batch lưu ngay như ô thường.
        if (Object.keys(snapshot).length > 0) {
          setPending((prev) => {
            const next = new Map(prev);
            next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), ...snapshot });
            return next;
          });
          if (!batchEdit) {
            void onSave(rowId, snapshot).catch((e) => setSaveErr((e as Error).message));
          }
        }
      });
    }
    if (!batchEdit) {
      void onSave(rowId, { [field]: value }).catch((e) => setSaveErr((e as Error).message));
    }
  };

  // ── Thêm dòng MỚI (nháp) vào lưới — lên đầu / xuống cuối. Giá trị ô của dòng
  //    mới gom chung `pending` theo id tạm (`__new_*`); "Lưu tất cả" mới tạo
  //    record. id tạm = thời điểm + seq → không trùng UUID dòng thật. ──────────
  const newRowSeq = useRef(0);
  // Sau khi thêm dòng → báo DataGrid lật tới trang đầu/cuối để THẤY dòng mới
  // (tránh dòng mới nằm trang khác do phân trang).
  const [pageJump, setPageJump] = useState<{ token: number; to: "first" | "last" }>();
  const addRow = (pos: "top" | "bottom") => {
    const seq = newRowSeq.current++;
    setNewRows((prev) => [...prev, { id: `__new_${Date.now()}_${seq}`, pos }]);
    setPageJump({ token: seq, to: pos === "top" ? "first" : "last" });
  };
  const removeRowRef = useRef<(id: string) => void>(() => {});
  removeRowRef.current = (id) => {
    setNewRows((prev) => prev.filter((r) => r.id !== id));
    setPending((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setRefOverlay((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  // Data hiển thị = dòng mới nháp (đầu) + filteredRows + overlay pending + dòng
  // mới nháp (cuối). Dòng mới đánh dấu __isNew để DataGrid tô nền + cho phép xoá.
  const displayData = useMemo(() => {
    const hasOverlay = pending.size > 0 || refOverlay.size > 0;
    const base = !hasOverlay
      ? filteredRows
      : filteredRows.map((row) => {
          const id = String(row.id);
          const p = pending.get(id);
          const o = refOverlay.get(id);
          return p || o ? { ...row, ...o, ...p } : row;
        });
    if (newRows.length === 0) return base;
    const synth = (r: NewRowDraft) => ({
      ...createDefaults,
      ...(refOverlay.get(r.id) ?? {}),
      ...(pending.get(r.id) ?? {}),
      id: r.id,
      __isNew: true,
    });
    const top = newRows.filter((r) => r.pos === "top").map(synth);
    const bottom = newRows.filter((r) => r.pos === "bottom").map(synth);
    return [...top, ...base, ...bottom];
  }, [filteredRows, pending, refOverlay, newRows, createDefaults]);

  // Tập id dòng có thay đổi pending — truyền xuống DataGrid để tô màu.
  const changedRowIdsEdit = useMemo(() => new Set(pending.keys()), [pending]);

  // Dán dữ liệu (PasteGridModal) → cập nhật nhiều dòng: overlay pending (hiện
  // ngay) + lưu từng dòng (gom field). Lỗi 1 dòng không chặn dòng khác.
  const applyPaste = async (updates: Array<{ rowId: string; changes: Record<string, string> }>) => {
    if (!updates.length) return;
    setPending((prev) => {
      const next = new Map(prev);
      for (const u of updates) next.set(u.rowId, { ...(next.get(u.rowId) ?? {}), ...u.changes });
      return next;
    });
    for (const u of updates) {
      await onSave(u.rowId, u.changes).catch((e) => setSaveErr((e as Error).message));
    }
  };

  // Cột TanStack: cell = ô sửa inline. Cột số → summary=sum (footer tổng hợp).
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const cols: ColumnDef<Record<string, unknown>>[] = visibleFields.map((f) => ({
      id: f.name,
      accessorKey: f.name,
      header: columnLabels?.[f.name] ?? f.label,
      enableGrouping: true,
      meta: {
        techName: f.name,
        ...(f.type === "number" || f.type === "integer" || f.type === "currency"
          ? { summary: "sum" as const }
          : { noSummary: true }),
      },
      cell: (ctx) => {
        const row = ctx.row.original as Record<string, unknown> & { id?: unknown };
        // editableFields giới hạn cột sửa được: ngoài danh sách → hiển thị read-only.
        if (editableFields && !editableFields.includes(f.name)) {
          const rv = ctx.getValue();
          const rs = rv == null ? "" : String(rv);
          if (
            f.type === "image" &&
            (rs.startsWith("data:image/") ||
              rs.startsWith("/files/img/") ||
              rs.startsWith("/f/") ||
              /^https?:\/\//.test(rs))
          )
            return (
              <ImageCell url={rs} className="h-6 max-w-[120px] object-contain mx-auto py-0.5" />
            );
          if (f.type === "file" && (rs.startsWith("/files/doc/") || rs.startsWith("/f/"))) {
            return <FileCell url={rs} />;
          }
          if (f.type === "boolean" || f.type === "bool") {
            const checked = rv === true || rs === "true" || rs === "1" || rs.toLowerCase() === "có";
            return (
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  aria-label="Trạng thái"
                  className="accent-accent w-3.5 h-3.5 cursor-default opacity-80"
                />
              </span>
            );
          }
          const disp =
            f.type === "date" || f.type === "datetime"
              ? fmtDateCell(rs, f.type === "datetime")
              : rs;
          return <span className="block truncate">{disp}</span>;
        }
        if (f.type === "drawing_page") {
          return (
            <DrawingPageCell
              masp={String(row.masp ?? "")}
              detail={{
                mact: String(row.mact ?? ""),
                chitiet: String(row.chitiet ?? ""),
                dims: [row.dayy_tc, row.rong_tc, row.dai_tc].map((v) => v as string | number),
              }}
              page={String(ctx.getValue() ?? "")}
              canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
              onCommit={(v) => saveRef.current(row.id, f.name, v)}
            />
          );
        }
        return (
          <EditableCell
            value={ctx.getValue()}
            isImage={f.type === "image"}
            canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
            onCommit={(v) => saveRef.current(row.id, f.name, v)}
            fieldType={f.type}
            refEntityId={
              (f as { ref?: string }).ref || (f as { relationEntityId?: string }).relationEntityId
            }
            refValueField={(f as { refValueField?: string }).refValueField}
            getLookupOptions={() =>
              Array.from(ctx.column.getFacetedUniqueValues().keys())
                .filter((v) => v != null && String(v).trim() !== "")
                .map((v) => String(v))
                .sort((a, b) => a.localeCompare(b))
                .slice(0, 500)
            }
          />
        );
      },
    }));
    // Cột TÍNH read-only (derivedColumns): % chênh lệch giữa 2 cột số. Tăng → đỏ
    // (danger), giảm → xanh (success). Mẫu số = từ (from); from rỗng/0 → "—".
    for (const dc of derivedColumns ?? []) {
      cols.push({
        id: dc.field,
        header: columnLabels?.[dc.field] ?? dc.label ?? dc.field,
        enableGrouping: false,
        enableSorting: false,
        meta: { techName: dc.field, noSummary: true },
        cell: (ctx) => {
          const row = ctx.row.original as Record<string, unknown>;
          const from = Number(row[dc.from]);
          const to = Number(row[dc.to]);
          if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) {
            return <span className="block text-right text-muted">—</span>;
          }
          const pct = ((to - from) / from) * 100;
          const cls = pct > 0 ? "text-danger" : pct < 0 ? "text-success" : "text-muted";
          const sign = pct > 0 ? "+" : "";
          return (
            <span className={`block text-right tabular-nums ${cls}`}>
              {sign}
              {pct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
            </span>
          );
        },
      });
    }
    // Cột ✕ RIÊNG để bỏ dòng MỚI nháp — CHỉ khi lưới KHÔNG có cột hành động.
    // Có cột hành động (__rowacts__) → ✕ nằm TRONG cột đó (cell __isNew bên dưới).
    const hasActionCol = !!(rowActions && rowActions.length > 0);
    if (newRows.length > 0 && !hasActionCol) {
      cols.unshift({
        id: "__rmnew",
        header: "",
        enableGrouping: false,
        enableSorting: false,
        size: 32,
        cell: (ctx) => {
          const row = ctx.row.original as { id?: unknown; __isNew?: boolean };
          if (!row.__isNew) return null;
          return <RemoveNewRowButton onRemove={() => removeRowRef.current(String(row.id))} />;
        },
      });
    }
    // Cột "Hành động" (Xem/Sửa/Xoá) — render ActionWidget cho từng dòng đã lưu
    // (dòng MỚI chưa có id → bỏ qua). Đặt đầu lưới.
    if (rowActions && rowActions.length > 0) {
      // Mặc định INLINE (Xem/Sửa/Xoá thẳng dòng); chỉ "popover" khi đặt rõ.
      const inline = rowActionsStyle !== "popover";
      cols.unshift({
        id: "__rowacts__",
        // Tiêu đề gọn: icon ⋯ (không chiếm chỗ như chữ "Hành động").
        header: () => (
          <span title="Hành động">
            <I.MoreHorizontal size={13} className="text-muted/70" />
          </span>
        ),
        enableGrouping: false,
        enableSorting: false,
        meta: { compact: true, label: "Hành động" }, // gọn + nhãn ở "Chọn cột hiển thị"
        // PHẢI có size số (kể cả inline) → cột được GHIM (resize kéo nhỏ/rộng được +
        // không tự giãn theo nội dung). size undefined = table-auto, không kéo được.
        // Mặc định inline tính theo số nút; người dùng kéo đổi, width được nhớ.
        size: inline ? Math.min(48 + rowActions.length * 40, 240) : 28,
        // Sàn hẹp: cột compact tự co theo NÚT (autofit COMPACT_CLAMP ~24-30px) —
        // minSize cao sẽ kẹp ngược lại làm cột rộng hơn tổng bề rộng các nút.
        minSize: 24,
        cell: (ctx) => {
          const row = ctx.row.original as Record<string, unknown> & {
            id?: unknown;
            __isNew?: boolean;
          };
          // Dòng MỚI nháp → nút ✕ bỏ dòng ngay TRONG cột hành động (thay cho
          // Xem/Sửa/Xoá của dòng đã lưu).
          if (row.__isNew)
            return (
              <div className="flex items-center w-fit" onClick={(e) => e.stopPropagation()}>
                <RemoveNewRowButton onRemove={() => removeRowRef.current(String(row.id))} />
              </div>
            );
          // bindRowIdToAction nhận row (hỗ trợ recordIdField — bind theo field
          // nghiệp vụ thay vì id uuid).
          const bound = rowActions.map((a) => bindRowIdToAction(a, row));
          if (inline) {
            return (
              // w-fit: co sát các nút (flex thường là block → giãn đầy ô, khiến
              // autofit đo ra bề rộng Ô thay vì bề rộng NÚT). data-col-content:
              // mốc để measureCol đo đúng cụm nút → cột bám sát tổng các nút.
              <div
                data-col-content=""
                className="flex items-center gap-0.5 w-fit"
                onClick={(e) => e.stopPropagation()}
              >
                {bound.map((a) => (
                  <ActionWidget key={a.label} config={a} pageState={pageState} inline compact />
                ))}
              </div>
            );
          }
          return (
            <RowActionsCell
              actions={bound}
              pageState={pageState}
              row={row}
              cols={visibleFields.map((f) => ({
                key: f.name,
                label: columnLabels?.[f.name] ?? f.label ?? f.name,
              }))}
              title={title}
              hidden={rowActionsHidden}
            />
          );
        },
      });
    }
    return cols;
  }, [
    visibleFields,
    columnLabels,
    editableFields,
    rbacRole,
    myGroupIds,
    newRows.length,
    rowActions,
    pageState,
    title,
    rowActionsHidden,
    rowActionsStyle,
    derivedColumns,
  ]);

  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    setRowErrs([]);
    // Tách: dòng MỚI (tạo qua onBulkCreate) vs ô sửa dòng cũ (update batch).
    const newIds = new Set(newRows.map((r) => r.id));
    const updates = new Map([...pending].filter(([id]) => !newIds.has(id)));
    const creates = newRows
      .map((r) => ({ ...createDefaults, ...(pending.get(r.id) ?? {}) }))
      .filter((rec) => Object.keys(rec).length > 0);
    if (creates.length > 0) {
      if (!onBulkCreate) {
        setSaveErr("Lưới này chưa hỗ trợ tạo dòng mới.");
        setSaving(false);
        return;
      }
      try {
        await onBulkCreate(creates);
      } catch (e) {
        // Tạo lỗi → GIỮ nháp dòng mới để user sửa lại, không mất.
        setSaveErr((e as Error).message);
        setSaving(false);
        return;
      }
      // Tạo xong → bỏ nháp dòng mới + pending + overlay của chúng.
      setNewRows([]);
      setPending((prev) => {
        const next = new Map(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      setRefOverlay((prev) => {
        const next = new Map(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }
    const { failed, errs, cancelled } = await runBatchSave(
      updates,
      rowLabel,
      { batchOps, onSaveRow: onSave },
      t,
    );
    if (!cancelled) {
      setPending(failed);
      setRowErrs(errs);
      // Dòng lưu THÀNH CÔNG → bỏ overlay (refetch server mang giá trị join đúng);
      // giữ overlay cho dòng còn lỗi (pending của chúng còn).
      setRefOverlay((prev) => new Map([...prev].filter(([id]) => failed.has(id))));
    }
    setSaving(false);
  };

  return (
    <div className="h-full flex flex-col">
      {loading && (
        <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
          <I.Table size={11} />
          {title ?? ent?.name ?? "List"}
          <span className="ml-auto">{t("widget.loading")}</span>
        </div>
      )}
      {embeddedActions && embeddedActions.length > 0 && (
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
          {embeddedActions.map((item) => (
            <ActionWidget key={item.id} config={item} pageState={pageState} inline />
          ))}
        </div>
      )}
      {batchEdit &&
        (pending.size > 0 || newRows.length > 0) &&
        (() => {
          // Đếm tách: dòng MỚI (nháp) vs dòng cũ có ô sửa (pending không tính dòng mới).
          const newIdSet = new Set(newRows.map((r) => r.id));
          const editCount = [...pending.keys()].filter((id) => !newIdSet.has(id)).length;
          const parts: string[] = [];
          if (newRows.length > 0) parts.push(`${newRows.length} dòng mới`);
          if (editCount > 0) parts.push(`${editCount} dòng sửa`);
          return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
              <I.AlertCircle size={12} className="text-warning shrink-0" />
              <span className="text-xs text-warning shrink-0">{parts.join(" · ")} chưa lưu</span>
              {/* Lỗi theo từng dòng — nhãn + tooltip; dòng lỗi giữ lại để thử lại. */}
              {rowErrs.length > 0 ? (
                <span
                  className="text-xs text-danger flex-1 truncate"
                  title={rowErrs.map((r) => `${r.label}: ${r.msg}`).join("\n")}
                >
                  ⚠ {rowErrs.length} dòng lỗi:{" "}
                  {rowErrs
                    .slice(0, 3)
                    .map((r) => r.label)
                    .join(", ")}
                  {rowErrs.length > 3 ? "…" : ""}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                disabled={saving}
                onClick={saveAll}
                className="px-2.5 py-0.5 rounded text-xs bg-warning text-white hover:bg-warning/90 disabled:opacity-50"
              >
                {saving ? t("common.saving") : t("common.save_all")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setPending(new Map());
                  setNewRows([]);
                  setRowErrs([]);
                }}
                className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
              >
                {t("common.cancel")}
              </button>
            </div>
          );
        })()}
      {!batchEdit && saveErr && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {saveErr}
        </div>
      )}
      {err ? (
        <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
      ) : gateClosed && filteredRows.length === 0 && !loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted">{emptyText ?? t("widget.gate_hint")}</span>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          {/* Lưới đầy đủ chức năng (sort/filter/group/summary/export/resize/
              reorder/chooser) — ô sửa inline qua EditableCell trong column.cell. */}
          <DataGrid
            columns={columns}
            columnGroups={columnGroups}
            data={displayData}
            emptyText={emptyText ?? t("widget.empty_records")}
            label={title}
            onRowClick={onRowClick}
            isRowSelected={isRowSelected}
            onPasteApply={applyPaste}
            onPasteCreate={onBulkCreate}
            pasteCreateDefaults={createDefaults}
            onAddRow={batchEdit && onBulkCreate ? addRow : undefined}
            inlineAddRow={addRowAtEnd}
            addRowPos={addRowPos}
            pageJump={pageJump}
            enableSelection={selectable}
            changedRowIds={changedRowIdsEdit}
            rowClassName={
              highlightEmptyFields && highlightEmptyFields.length > 0
                ? (r) =>
                    highlightEmptyFields.some((fn) => {
                      const v = (r as Record<string, unknown>)[fn];
                      return v == null || String(v).trim() === "";
                    })
                      ? "bg-warning/20 hover:bg-warning/25"
                      : undefined
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

/* ─── ServerPagedListWidget — danh sách bảng LỚN, phân trang/sắp/lọc SERVER-SIDE.
   KHÔNG kéo cả cửa sổ về client: mỗi trang là 1 round-trip → sort/lọc/đếm phản
   ánh TOÀN BẢNG (không chỉ window). Hỗ trợ sửa ô inline (ghi về entity/
   datasource, overlay pending xuyên trang theo id). Không có filter-tree/
   master-detail client (cần toàn bộ dòng) — dùng loadFilters (server-side) +
   lọc-cột contains thay thế. ── */
export function ServerPagedListWidget({
  entityId,
  dataSourceId,
  stateKey,
  fields,
  columnLabels,
  title,
  pageSize,
  loadFilters,
  loadGate,
  selectionStateKey,
  multiSelect,
  editable,
  batchEdit,
  columnGroups,
  selectable,
}: {
  entityId?: string;
  dataSourceId?: string;
  stateKey?: string;
  fields?: string[];
  columnLabels?: Record<string, string>;
  title?: string;
  pageSize?: number;
  loadFilters?: LoadFilters;
  loadGate?: string;
  selectionStateKey?: string;
  multiSelect?: boolean;
  editable?: boolean;
  batchEdit?: boolean;
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Bật chọn dòng (checkbox). */
  selectable?: boolean;
}) {
  const t = useT();
  const ent = useEntity(entityId);
  const pageState = usePageState();
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);

  // Cổng tải (loadGate): chỉ fetch khi state có giá trị.
  const gateKey = loadGate?.trim();
  const gateVal = gateKey ? pageState.get(gateKey) : undefined;
  const enabled =
    !gateKey ||
    !(
      gateVal === undefined ||
      gateVal === null ||
      gateVal === "" ||
      (Array.isArray(gateVal) && gateVal.length === 0)
    );
  const ps = pageSize && pageSize > 0 ? pageSize : 50;

  // Cột số hiển thị → aggregates (footer summary toàn bảng). CHỈ entity-backed
  // (datasource chưa hỗ trợ aggregate server-side). Tính từ ent.fields (có sẵn
  // trước hook) để truyền vào hook.
  const fieldsKey = fields ? fields.join(",") : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám fieldsKey thay mảng fields
  const aggregates = useMemo<AggSpec[]>(() => {
    if (dataSourceId || !ent) return [];
    const all = ent.fields ?? [];
    const vis =
      fields && fields.length > 0
        ? (fields.map((n) => all.find((f) => f.name === n)).filter(Boolean) as EntityField[])
        : all.filter((f) => f.defaultVisible !== false);
    return vis
      .filter((f) => f.type === "number" || f.type === "integer")
      .map((f) => ({ field: f.name, fn: "sum" }));
  }, [ent, dataSourceId, fieldsKey]);

  const {
    rows,
    fields: dataFields,
    total,
    loading,
    err,
    onQueryChange,
    refresh,
    summary,
  } = useServerPagedRecords({
    entityId,
    dataSourceId,
    baseFilters: loadFilters,
    pageSize: ps,
    enabled,
    aggregates,
  });

  const allFields = dataSourceId ? dataFields : (ent?.fields ?? []);
  const visibleFields =
    fields && fields.length > 0
      ? (fields.map((n) => allFields.find((f) => f.name === n)).filter(Boolean) as EntityField[])
      : allFields.filter((f) => f.defaultVisible !== false);

  // Map summary (field→số) → controller.summary (colId→{type,value}) cho footer.
  const serverSummary = useMemo(() => {
    const out: Record<string, { type: "sum"; value: number }> = {};
    for (const a of aggregates) {
      const v = summary[a.field];
      if (v !== undefined) out[a.field] = { type: "sum", value: v };
    }
    return out;
  }, [aggregates, summary]);

  // ── Inline-edit (chỉ khi editable): pending overlay + ghi về server. ──
  const { pending, setPending } = usePersistedDraft(
    stateKey ? `${stateKey}:editdraft` : undefined,
    !!batchEdit,
  );
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Lỗi theo TỪNG dòng sau "Lưu tất cả" — [{ id, label, msg }].
  const [rowErrs, setRowErrs] = useState<Array<{ id: string; label: string; msg: string }>>([]);

  // Guard "pending chưa lưu": batchEdit còn ô sửa chưa lưu → chặn điều hướng
  // TRONG app (confirm dialog) + reload/đóng tab (native prompt). Chống mất edit
  // dồn qua nhiều trang server. (Lật trang server KHÔNG mất — pending sống xuyên
  // trang vì component không unmount.)
  const hasUnsaved = !!batchEdit && pending.size > 0;
  useBlocker({
    shouldBlockFn: async () => {
      if (!hasUnsaved) return false;
      const leave = await dialog.confirm(t("widget.unsaved_leave", { count: pending.size }), {
        title: t("widget.unsaved_title"),
        danger: true,
      });
      return !leave; // chặn nếu user chọn ở lại
    },
    enableBeforeUnload: () => hasUnsaved,
  });

  const writeRecord = (rowId: unknown, changes: Record<string, unknown>) =>
    dataSourceId
      ? api.updateDataSourceRecord(dataSourceId, String(rowId), changes).then(() => undefined)
      : api.updateRecord(String(rowId), changes).then(() => undefined);
  // Bulk + dry-run validate — chỉ entity-backed (datasource ghi từng dòng).
  const batchOps: BatchOps | undefined =
    !dataSourceId && entityId
      ? {
          validate: (items) => api.bulkValidateRecords(entityId, items).then((r) => r.results),
          bulkUpdate: (ids, patch) => api.bulkUpdateRecords(entityId, ids, patch),
        }
      : undefined;
  // Nhãn dòng để báo lỗi — lấy giá trị field hiển thị đầu tiên (nếu dòng đang
  // ở trang hiện tại), else id rút gọn (dòng đã sửa ở trang khác).
  const rowLabel = (rowId: string): string => {
    const r = rows.find((x) => String(x.id) === rowId);
    const first = visibleFields[0]?.name;
    const v = r && first ? r[first] : undefined;
    return v != null && String(v).trim() ? String(v) : `#${rowId.slice(0, 8)}`;
  };
  // saveRef: cell renderer (trong columns memo) luôn gọi bản mới nhất mà không
  // rebuild cột mỗi lần pending đổi.
  const saveRef = useRef<(rowId: unknown, field: string, value: string) => void>(() => {});
  saveRef.current = (rowId, field, value) => {
    if (rowId == null) return;
    const rowIdStr = String(rowId);
    setPending((prev) => {
      const next = new Map(prev);
      next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), [field]: value });
      return next;
    });
    if (!batchEdit) {
      void writeRecord(rowId, { [field]: value })
        .then(() => refresh())
        .catch((e) => setSaveErr((e as Error).message));
    }
  };
  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    setRowErrs([]);
    const { failed, errs, cancelled } = await runBatchSave(
      pending,
      rowLabel,
      { batchOps, onSaveRow: writeRecord },
      t,
    );
    if (!cancelled) {
      setPending(failed);
      setRowErrs(errs);
    }
    setSaving(false);
    if (!cancelled) refresh();
  };

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      visibleFields.map((f) => ({
        id: f.name,
        accessorKey: f.name,
        header: columnLabels?.[f.name] ?? f.label,
        enableGrouping: false,
        meta: { techName: f.name },
        cell: editable
          ? (ctx) => (
              <EditableCell
                value={ctx.getValue()}
                isImage={f.type === "image"}
                canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
                onCommit={(v) =>
                  saveRef.current((ctx.row.original as { id?: unknown }).id, f.name, v)
                }
                fieldType={f.type}
                refEntityId={
                  (f as { ref?: string }).ref ||
                  (f as { relationEntityId?: string }).relationEntityId
                }
                refValueField={(f as { refValueField?: string }).refValueField}
                getLookupOptions={() =>
                  Array.from(ctx.column.getFacetedUniqueValues().keys())
                    .filter((v) => v != null && String(v).trim() !== "")
                    .map((v) => String(v))
                    .sort((a, b) => a.localeCompare(b))
                    .slice(0, 500)
                }
              />
            )
          : (ctx) => {
              const v = ctx.getValue();
              const s = v == null ? "" : String(v);
              if (
                f.type === "image" &&
                (s.startsWith("data:image/") ||
                  s.startsWith("/files/img/") ||
                  s.startsWith("/f/") ||
                  /^https?:\/\//.test(s))
              )
                return (
                  <ImageCell url={s} className="h-6 max-w-[120px] object-contain mx-auto py-0.5" />
                );
              if (f.type === "file" && (s.startsWith("/files/doc/") || s.startsWith("/f/"))) {
                return <FileCell url={s} />;
              }
              if (f.type === "boolean" || f.type === "bool") {
                const checked = v === true || s === "true" || s === "1" || s.toLowerCase() === "có";
                const canWrite = fieldCan(rbacRole, "write", f, myGroupIds);
                return (
                  <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canWrite}
                      onChange={(e) =>
                        saveRef.current(
                          (ctx.row.original as { id?: unknown }).id,
                          f.name,
                          e.target.checked ? "true" : "false",
                        )
                      }
                      aria-label="Bật/tắt"
                      className="accent-accent w-3.5 h-3.5 cursor-pointer disabled:cursor-default disabled:opacity-60"
                    />
                  </span>
                );
              }
              const disp =
                f.type === "date" || f.type === "datetime"
                  ? fmtDateCell(s, f.type === "datetime")
                  : s;
              return <span className="block truncate">{disp}</span>;
            },
      })),
    [visibleFields, columnLabels, editable, rbacRole, myGroupIds],
  );

  // Data hiển thị = rows trang hiện tại + overlay pending (ô đã sửa, theo id).
  const displayData = useMemo(() => {
    if (!editable || pending.size === 0) return rows;
    return rows.map((row) => {
      const p = pending.get(String(row.id));
      return p ? { ...row, ...p } : row;
    });
  }, [rows, pending, editable]);

  const changedRowIdsSvr = useMemo(() => new Set(pending.keys()), [pending]);

  const server = useMemo<ServerPagingController>(
    () => ({
      total,
      loading,
      onQueryChange: (q) => onQueryChange(q),
      summary: Object.keys(serverSummary).length ? serverSummary : undefined,
    }),
    [total, loading, onQueryChange, serverSummary],
  );

  // Chọn dòng (lưu id vào pageState) — hoạt động xuyên trang vì lưu theo id.
  const selectedRaw = selectionStateKey ? pageState.get(selectionStateKey) : undefined;
  const onRowClick = selectionStateKey
    ? (row: Record<string, unknown>) => {
        const id = row.id ?? row.ID ?? row._id;
        if (id == null) return;
        if (multiSelect) {
          const strId = String(id);
          const cur = Array.isArray(selectedRaw) ? (selectedRaw as unknown[]) : [];
          const already = cur.some((x) => String(x) === strId);
          pageState.set(
            selectionStateKey,
            already ? cur.filter((x) => String(x) !== strId) : [...cur, id],
          );
        } else {
          pageState.set(selectionStateKey, id);
        }
      }
    : undefined;
  const isRowSelected = selectionStateKey
    ? (row: Record<string, unknown>) => {
        const id = row.id ?? row.ID ?? row._id;
        if (id == null) return false;
        if (multiSelect)
          return (
            Array.isArray(selectedRaw) &&
            (selectedRaw as unknown[]).some((x) => String(x) === String(id))
          );
        return selectedRaw != null && String(selectedRaw) === String(id);
      }
    : undefined;

  if (!entityId && !dataSourceId) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_list")}</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {err && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {t("widget.error_load", { err })}
        </div>
      )}
      {editable && batchEdit && pending.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
          <I.AlertCircle size={12} className="text-warning shrink-0" />
          <span className="text-xs text-warning shrink-0">
            {t("widget.pending_records", { count: pending.size })}
          </span>
          {/* Lỗi theo từng dòng — nhãn + tooltip thông điệp đầy đủ. Dòng lỗi vẫn
              nằm trong pending (count trên) để thử lại. */}
          {rowErrs.length > 0 && (
            <span
              className="text-xs text-danger flex-1 truncate"
              title={rowErrs.map((r) => `${r.label}: ${r.msg}`).join("\n")}
            >
              ⚠ {rowErrs.length} dòng lỗi:{" "}
              {rowErrs
                .slice(0, 3)
                .map((r) => r.label)
                .join(", ")}
              {rowErrs.length > 3 ? "…" : ""}
            </span>
          )}
          {rowErrs.length === 0 && <span className="flex-1" />}
          <button
            type="button"
            disabled={saving}
            onClick={saveAll}
            className="px-2.5 py-0.5 rounded text-xs bg-warning text-white hover:bg-warning/90 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save_all")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPending(new Map());
              setRowErrs([]);
            }}
            className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {editable && !batchEdit && saveErr && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {saveErr}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DataGrid
          columns={columns}
          columnGroups={columnGroups}
          data={displayData}
          stateKey={stateKey}
          emptyText={t("widget.empty_records")}
          label={title}
          onRowClick={onRowClick}
          isRowSelected={isRowSelected}
          pageSize={ps}
          server={server}
          enableSelection={selectable}
          changedRowIds={changedRowIdsSvr}
        />
      </div>
    </div>
  );
}

/** Cấu hình cột "Hành động" (Xem/Sửa) mở dialog record con master-detail. */
/** Gắn id của dòng vào action per-row: mọi step có recordIdBinding
 *  (open-popup/delete-record/open-wizard) → trỏ tới recordId của đúng dòng bấm.
 *  recordId = row[action.recordIdField] nếu cấu hình (khoá nghiệp vụ, vd
 *  id_quytrinh), ngược lại row.id (uuid). */
function bindRowIdToAction(action: ActionConfig, row: Record<string, unknown>): ActionConfig {
  const rowId =
    action.recordIdField != null ? row[action.recordIdField] : (row.id ?? row.ID ?? row._id);
  // recordIdBinding mặc định = id dòng. NHƯNG nếu cấu hình đã trỏ page-state/template
  // (vd cập nhật 1 record KHÁC chọn từ popup) thì GIỮ NGUYÊN — chỉ ghi đè khi
  // chưa cấu hình hoặc đang là const (mặc định "thao tác trên chính dòng này").
  const keepRid = (rid: BindingValue | undefined): boolean =>
    rid != null && (rid.source === "state" || rid.source === "template");
  // Thay sentinel bằng GIÁ TRỊ của dòng: "$rowId" → id dòng; "$row.<field>" →
  // row[field]. Áp cho cả chuỗi trần (field-map) lẫn const BindingValue (listFilters).
  // Cho phép gán dữ liệu của dòng (id phiên bản, mã màu...) vào record/khác hoặc
  // bộ lọc popup.
  const subSentinel = (v: unknown): unknown => {
    let raw: unknown = v;
    if (v != null && typeof v === "object" && (v as BindingValue).source === "const") {
      raw = (v as { value?: unknown }).value;
    } else if (typeof v !== "string") {
      return v;
    }
    if (raw === "$rowId") return { source: "const" as const, value: rowId };
    if (typeof raw === "string" && raw.startsWith("$row.")) {
      return { source: "const" as const, value: row[raw.slice(5)] };
    }
    return v;
  };
  const subFields = <T,>(fields: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [f, v] of Object.entries(fields)) out[f] = subSentinel(v) as T;
    return out;
  };
  return {
    ...action,
    steps: action.steps.map((s) => {
      if (s.kind === "update-fields") {
        return {
          ...s,
          fields: subFields(s.fields),
          recordIdBinding: keepRid(s.recordIdBinding)
            ? s.recordIdBinding
            : { source: "const" as const, value: rowId },
        };
      }
      if (s.kind === "update-many-fields") {
        // recordIdsBinding luôn từ cấu hình (state popup multiSelect) — không ép id dòng.
        return { ...s, fields: subFields(s.fields) };
      }
      if (s.kind === "update-record") {
        return keepRid(s.recordIdBinding)
          ? s
          : { ...s, recordIdBinding: { source: "const" as const, value: rowId } };
      }
      if (s.kind === "open-popup") {
        // listFilters: thay "$row.<field>" → giá trị màu/khoá của dòng để lọc popup.
        return {
          ...s,
          recordIdBinding: { source: "const" as const, value: rowId },
          ...(s.listFilters ? { listFilters: subFields(s.listFilters) } : {}),
        };
      }
      // invoke-module-proc: inject _id (UUID dòng) vào args để proc nhận biết record.
      if (s.kind === "invoke-module-proc") {
        return {
          ...s,
          args: { ...(s.args ?? {}), _id: { source: "const" as const, value: rowId } },
        };
      }
      return s.kind === "delete-record" || s.kind === "open-wizard"
        ? { ...s, recordIdBinding: { source: "const" as const, value: rowId } }
        : s;
    }),
  };
}

/** Widget "list" — bảng record thật, cột suy từ field của entity. */
export function ListWidget({
  entityId,
  dataSourceId,
  stateKey,
  fields,
  columnLabels,
  selectionStateKey,
  selectionField,
  selectionEmits,
  filterFromState,
  filterConditions,
  filters,
  searchFromState,
  searchStateKey,
  title,
  multiSelect,
  editable,
  editableFields,
  highlightEmptyFields,
  computedColumns,
  derivedColumns,
  batchEdit,
  excelMode,
  rowLimit,
  pageSize,
  loadFilters,
  loadGate,
  emptyStateShowsAll,
  columnGroups,
  defaultGrouping,
  rowDetail,
  createForm,
  editForm,
  rowActions,
  rowActionsBuiltin,
  rowActionsHidden,
  rowActionsStyle,
  editFields,
  selectable,
  embeddedActions,
  embeddedFilters: _embeddedFilters,
  addRowAtEnd,
  addRowPos,
  defaultSort,
  refetchOnSave,
  valueLabels,
}: {
  entityId?: string;
  stateKey?: string;
  fields?: string[];
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Gom HÀNG theo cột mặc định khi chưa có view lưu (vd ["phanloai"]). */
  defaultGrouping?: string[];
  /** Override nhãn header theo cột (field name → header DQHF của form gốc).
   *  Ưu tiên hơn label DataSource (global) — cho phép mỗi page hiện đúng
   *  tiêu đề cột của form DQHF tương ứng. */
  columnLabels?: Record<string, string>;
  /** Phase V: khi click row, set page-state[selectionStateKey] = row.id. */
  selectionStateKey?: string;
  /** Lưu giá trị field nghiệp vụ (vd "masp") vào selectionStateKey thay vì id uuid
   *  — để list chi tiết filterFromState theo cột nghiệp vụ (master-detail không UUID). */
  selectionField?: string;
  /** Khi click dòng, lưu THÊM giá trị các field khác vào state ({stateKey: field}).
   *  Vd {selKetcau: "ketcau"} để widget khác ẩn/hiện theo kết cấu SP đang chọn. */
  selectionEmits?: Record<string, string>;
  /** Legacy single-equality filter. Khi state rỗng → hide all rows
   *  (master-detail), TRỪ KHI emptyStateShowsAll=true (combobox lọc:
   *  "tất cả" = rỗng → hiện hết). */
  filterFromState?: { field: string; stateKey: string };
  /** Nhiều điều kiện lọc AND từ nhiều cột phát / nhiều panel.
   *  Áp sau filterFromState (không thay thế). Khi bất kỳ điều kiện nào rỗng
   *  (state chưa có giá trị) → ẩn hết hàng (master-detail UX). */
  filterConditions?: Array<{ field: string; stateKey: string }>;
  /** V2: cây filter nâng cao. Ưu tiên hơn filterFromState. Pass-through khi
   *  state rỗng (page mới mở vẫn show full list). */
  filters?: FilterNode | null;
  /** Phase V: text search từ Search widget theo state key. */
  searchFromState?: string;
  /** V2 P5: stateKey để expose ô search nội bộ DataGrid ra pageState.
   *  Widget khác có thể đọc state key này (vd: filters.contains). */
  searchStateKey?: string;
  /** Phase V: tiêu đề widget hiển thị thay vì tên entity. */
  title?: string;
  /** Chọn nhiều dòng — lưu mảng id vào selectionStateKey thay vì id đơn. */
  multiSelect?: boolean;
  /** Cho phép sửa ô inline, lưu về datasource. */
  editable?: boolean;
  /** Chỉ cho sửa inline các field này (vd ["ma_ncc"] → riêng cột NCC là combobox
   *  chọn, còn lại read-only). Set giá trị này tự bật chế độ editable. */
  editableFields?: string[];
  /** Tô nổi bật dòng có field rỗng (vd ["ma_ncc"] → dòng chưa chọn NCC). */
  highlightEmptyFields?: string[];
  /** Cột tính client-side (vd thành tiền = sl_can × dongia) — cập nhật tức thì
   *  khi sửa factor, không cần refetchOnSave. */
  computedColumns?: Array<{ field: string; product: string[] }>;
  /** Cột TÍNH read-only (% chênh lệch 2 cột số) — pass-through xuống lưới. */
  derivedColumns?: Array<{
    field: string;
    label?: string;
    kind: "percentDelta";
    from: string;
    to: string;
  }>;
  /** Tích lũy thay đổi, hiện nút "Lưu tất cả" thay vì auto-save. */
  batchEdit?: boolean;
  /** Chế độ bảng tính kiểu Excel với hỗ trợ công thức. */
  excelMode?: boolean;
  /** Số dòng tối đa tải (mặc định 500). */
  rowLimit?: number;
  /** Số dòng hiển thị mỗi trang (phân trang client-side; mặc định 50). */
  pageSize?: number;
  /** Điều kiện lọc server-side áp trước khi cắt limit. */
  loadFilters?: LoadFilters;
  /** stateKey cổng: chỉ tải khi state có giá trị. */
  loadGate?: string;
  /** Bind tới nguồn dữ liệu (datasource) thay entity. */
  dataSourceId?: string;
  /** Khi filterFromState rỗng → hiện TẤT CẢ thay vì ẩn hết. Dùng cho list
   *  bị lái bởi combobox/listbox lọc (mục "tất cả"). Mặc định false để giữ
   *  hành vi master-detail. */
  emptyStateShowsAll?: boolean;
  /** Cột "Hành động" theo dòng — nút Xem/Sửa mở dialog danh sách record con
   *  (master-detail). Lọc child theo childField = giá trị parentField của dòng. */
  rowDetail?: RowDetailCfg;
  /** Nút "Thêm mới" mở dialog 2 tab tạo record cha + nhiều dòng con. */
  createForm?: CreateFormCfg;
  /** Nút "Sửa" theo dòng mở dialog 2 tab sửa record cha + dòng con (master-detail). */
  editForm?: CreateFormCfg;
  /** Nút hành động theo dòng (vd Sửa/Xóa) — id dòng tự bind vào step. */
  rowActions?: ActionConfig[];
  /** Cột hành động dựng sẵn (Xem/Sửa/Xoá) — bật trong cài đặt list (mặc định ẩn). */
  rowActionsBuiltin?: boolean;
  /** Field hiển thị trong form sửa built-in (khác list columns). Mặc định = fields. */
  editFields?: string[];
  /** Key các nút bị ẩn trên popover hành động (cài đặt list). */
  rowActionsHidden?: string[];
  /** Kiểu cột hành động: "popover" (⋯, mặc định) | "inline" (Xem/Sửa/Xoá). */
  rowActionsStyle?: "inline" | "popover";
  /** Bật chọn dòng (checkbox) — bật trong cài đặt list (mặc định ẩn). */
  selectable?: boolean;
  /** Nút embeddedActions render CÙNG hàng với nút "Thêm mới" trong header
   *  (thay vì strip riêng phía trên) — chỉ truyền khi list có createForm. */
  embeddedActions?: ActionBarItem[];
  /** Dropdown lọc ngay trong toolbar (cạnh nút Thêm) — set pageState[stateKey];
   *  list lọc qua cfg.filters tham chiếu stateKey đó. */
  embeddedFilters?: Array<{
    label?: string;
    stateKey: string;
    options?: string;
    optionLabels?: Record<string, string>;
  }>;
  /** Hiện DÒNG "＋ Thêm dòng mới" trong lưới (cfg.addRowAtEnd) — chỉ khi editable
   *  + batchEdit (mới tạo được dòng nháp). */
  addRowAtEnd?: boolean;
  /** Vị trí dòng thêm mới: "top" | "bottom" (cfg.addRowPos, mặc định "bottom"). */
  addRowPos?: "top" | "bottom";
  /** Sắp xếp mặc định khi chưa có view lưu — vd {field:"id",dir:"desc"} bản ghi
   *  mới lên đầu. Bản ghi sửa giữ vị trí (id không đổi). */
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Sau khi LƯU 1 ô inline (non-batch) → nạp lại lưới để cập nhật các cột phụ
   *  thuộc do server tính lại (vd diện tích sơn = base × phần trăm). */
  refetchOnSave?: boolean;
  /** Map value→label hiển thị theo cột (vd Phân loại TRONG→"Màu trong"). */
  valueLabels?: Record<string, Record<string, string>>;
}) {
  const t = useT();
  const ent = useEntity(entityId);
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const [editModal, setEditModal] = useState<{ id: string; readOnly: boolean } | null>(null);
  const [detailModal, setDetailModal] = useState<{ value: unknown; editable: boolean } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const pageState = usePageState();
  const effectiveSearchStateKey = searchStateKey || (stateKey ? `__search:${stateKey}` : undefined);
  // searchFromState (explicit SearchWidget config) → server-side q refetch.
  // effectiveSearchStateKey (DataGrid inline) → client-side globalFilter only,
  // không feed vào q tránh search_tsv rỗng trả về 0 row.
  const effectiveSearchFromState = searchFromState || effectiveSearchStateKey;
  const serverSearchVal = searchFromState ? (pageState.get(searchFromState) as string) : undefined;
  const clientSearchVal = effectiveSearchStateKey
    ? ((pageState.get(effectiveSearchStateKey) as string) ?? "")
    : undefined;

  const {
    rows,
    loading,
    err,
    fields: dataFields,
    isDataSource,
    update: dataUpdate,
    create: dataCreate,
    refFill,
  } = useWidgetData({
    entity: entityId,
    dataSourceId,
    rowLimit,
    loadFilters,
    loadGate,
    q: serverSearchVal,
    sort: defaultSort,
  });
  // Các ref cho cell functions trong useMemo — đọc giá trị mới nhất mà không cần
  // đưa vào deps (pageState thay identity mỗi khi set gọi; visibleFields/columnLabels
  // /title ít đổi). Khai báo sớm (trước conditional return) để tuân thủ rules of hooks.
  const pageStateRef = useRef(pageState);
  pageStateRef.current = pageState;
  const _rafVisibleFields = useRef<EntityField[]>([]);
  const _rafColumnLabels = useRef(columnLabels);
  _rafColumnLabels.current = columnLabels;
  const _rafTitle = useRef(title);
  _rafTitle.current = title;
  // RBAC để cho phép tick checkbox boolean ngay ở lưới (chỉ khi có quyền ghi field).
  // Cột hành động dựng sẵn (Xem/Sửa/Xoá) — gộp với rowActions cấu hình. Dùng
  // ActionWidget: Xem/Sửa mở popup detail/form của entity cho ĐÚNG dòng; Xoá =
  // confirm → delete-record (recordIdBinding gắn id dòng qua bindRowIdToAction).
  const effectiveRowActions = useMemo<ActionConfig[]>(() => {
    const base = rowActions ?? [];
    // Custom rowActions LUÔN hiện (nếu có). Builtin Xem/Sửa/Xoá chỉ thêm khi bật
    // rowActionsBuiltin → cho phép cấu hình "chỉ nút Xóa" mà không kèm Xem/Sửa.
    if (!rowActionsBuiltin) return base;
    if (!entityId) return base;
    const builtin = [
      {
        id: "__ra_view",
        label: "Xem",
        icon: "Eye",
        iconOnly: true,
        variant: "default",
        steps: [
          {
            id: "v",
            kind: "open-popup",
            title: "Xem chi tiết",
            entity: entityId,
            fields,
            popupMode: "detail",
            saveOutputTo: "_viewed",
          },
        ],
      },
      {
        id: "__ra_edit",
        label: "Sửa",
        icon: "Edit",
        iconOnly: true,
        variant: "default",
        steps: [
          {
            id: "e",
            kind: "open-popup",
            title: "Sửa",
            entity: entityId,
            fields: editFields ?? fields,
            popupMode: "form",
            persist: true,
            invalidateEntities: [entityId],
            saveOutputTo: "_edited",
          },
        ],
      },
      {
        id: "__ra_del",
        label: "Xoá",
        icon: "Trash",
        iconOnly: true,
        variant: "danger",
        steps: [
          {
            id: "c",
            kind: "confirm",
            title: "Xác nhận xoá",
            danger: true,
            message: "Xoá dòng này?",
          },
          { id: "d", kind: "delete-record", invalidateEntities: [entityId] },
        ],
      },
    ] as unknown as ActionConfig[];
    // Dedup: bỏ builtin nếu custom đã có hành động tương đương.
    // Xử lý 3 trường hợp hay gặp:
    //  1. Trùng nhãn chính xác (Sửa=Sửa).
    //  2. Spelling variant: "Xóa" (ó) ↔ "Xoá" (á) — cùng nghĩa xóa bản ghi.
    //  3. Builtin "Xem" bị che bởi bất kỳ hành động "Xem…" (vd "Xem chi tiết").
    const baseLabels = new Set(base.map((a) => a.label));
    const hasViewVariant = [...baseLabels].some((l) => l.startsWith("Xem"));
    return [
      ...base,
      ...builtin.filter((b) => {
        if (baseLabels.has(b.label)) return false;
        if (b.label === "Xoá" && baseLabels.has("Xóa")) return false;
        if (b.label === "Xóa" && baseLabels.has("Xoá")) return false;
        if (b.label === "Xem" && hasViewVariant) return false;
        return true;
      }),
    ];
  }, [rowActions, rowActionsBuiltin, entityId, fields, editFields]);

  // Field cố định cho dòng TẠO MỚI (dán thêm hàng loạt): suy từ loadFilters op
  // "=" (resolve fromState qua pageState) — vd masp = sản phẩm đang chọn ở bộ
  // lọc header. Tính inline mỗi render để bám selMasp hiện tại (re-render khi
  // đổi SP). Không memo vì pageState identity ổn định → memo sẽ ôm giá trị cũ.
  const createDefaults: Record<string, string> = {};
  {
    const lf = loadFilters as
      | Record<string, { op?: string; value?: unknown; fromState?: string }>
      | undefined;
    for (const [field, cond] of Object.entries(lf ?? {})) {
      if (cond.op !== "=") continue;
      const v = cond.fromState ? pageState.get(cond.fromState) : cond.value;
      if (v != null && v !== "") createDefaults[field] = String(v);
    }
  }
  // Dán THÊM MỚI: tạo từng record rồi refetch để hiện dòng mới (datasource
  // re-resolve join). Lỗi 1 record ném ra → PasteGridModal hiện lỗi.
  const bulkCreate = async (records: Array<Record<string, string>>) => {
    for (const r of records) await dataCreate(r);
    if (dataSourceId) {
      const key = `__refresh:ds:${dataSourceId}`;
      pageState.set(key, ((pageState.get(key) as number | undefined) ?? 0) + 1);
    }
  };

  // Cột "Hành động" theo dòng từ cấu hình rowActions (vd Sửa/Xóa) — mỗi nút là
  // ActionWidget với recordIdBinding trỏ tới id của đúng dòng.
  // Mặc định INLINE; chỉ "popover" khi đặt rõ.
  // useMemo phải khai báo TRƯỚC early return để tuân thủ rules of hooks.
  const rowActsInline = rowActionsStyle !== "popover";
  const rowActionCol = useMemo(
    () =>
      effectiveRowActions.length > 0
        ? [
            {
              id: "__rowacts__",
              header: () => (
                <span title="Hành động">
                  <I.MoreHorizontal size={13} className="text-muted/70" />
                </span>
              ),
              size: rowActsInline ? Math.min(48 + effectiveRowActions.length * 44, 240) : 28,
              minSize: 24,
              meta: { compact: true, label: "Hành động" },
              enableSorting: false,
              cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
                const bound = effectiveRowActions.map((a) => bindRowIdToAction(a, row.original));
                if (rowActsInline) {
                  return (
                    <div
                      data-col-content=""
                      className="flex items-center gap-1 w-fit"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {bound.map((a) => (
                        <ActionWidget
                          key={a.label}
                          config={a}
                          pageState={pageStateRef.current}
                          inline
                        />
                      ))}
                    </div>
                  );
                }
                return (
                  <RowActionsCell
                    actions={bound}
                    pageState={pageStateRef.current}
                    row={row.original}
                    cols={_rafVisibleFields.current.map((f) => ({
                      key: f.name,
                      label: _rafColumnLabels.current?.[f.name] ?? f.label ?? f.name,
                    }))}
                    title={_rafTitle.current}
                    hidden={rowActionsHidden}
                  />
                );
              },
            },
          ]
        : [],
    [effectiveRowActions, rowActsInline, rowActionsHidden],
  );

  if (!entityId && !dataSourceId) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_list")}</div>;
  }
  const allFields = isDataSource ? dataFields : (ent?.fields ?? []);

  // fields=[...] → dùng đúng list đó THEO THỨ TỰ fields (bám layout grid DQHF);
  // không có config → lọc theo defaultVisible của field (giữ thứ tự nguồn).
  const visibleFields =
    fields && fields.length > 0
      ? (fields
          .map((name) => allFields.find((f) => f.name === name))
          .filter(Boolean) as typeof allFields)
      : allFields.filter((f) => f.defaultVisible !== false);
  _rafVisibleFields.current = visibleFields;

  // V2: filters (cây) ưu tiên — pass-through default khi state rỗng.
  let filteredRows = rows;
  if (filters) {
    filteredRows = applyFilters(rows, filters, pageState);
  } else if (filterFromState) {
    // Legacy: hide all khi state rỗng (master-detail UX truyền thống).
    const stateVal = pageState.get(filterFromState.stateKey);
    if (
      stateVal !== undefined &&
      stateVal !== null &&
      stateVal !== "" &&
      !(Array.isArray(stateVal) && stateVal.length === 0)
    ) {
      filteredRows = rows.filter((r) => {
        const v = r[filterFromState.field];
        if (Array.isArray(stateVal)) {
          return (stateVal as string[]).includes(String(v));
        }
        return v === stateVal || String(v) === String(stateVal);
      });
    } else if (!emptyStateShowsAll && !Array.isArray(stateVal)) {
      // Rỗng + không bật emptyStateShowsAll → ẩn hết (master-detail).
      filteredRows = [];
    }
  }
  // filterConditions: AND nhiều điều kiện bổ sung (từ sourceFields đa cột).
  // Bất kỳ điều kiện nào rỗng → ẩn hết (master-detail UX nhất quán).
  if (filterConditions?.length) {
    const vals = filterConditions.map((c) => pageState.get(c.stateKey));
    const anyEmpty = vals.some(
      (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0),
    );
    if (anyEmpty) {
      filteredRows = [];
    } else {
      filteredRows = filteredRows.filter((r) =>
        filterConditions.every((c, i) => {
          const sv = vals[i];
          const v = r[c.field];
          if (Array.isArray(sv)) return (sv as string[]).includes(String(v));
          return v === sv || String(v) === String(sv);
        }),
      );
    }
  }

  // Phase V: text search từ Search widget.
  if (effectiveSearchFromState) {
    const q = ((pageState.get(effectiveSearchFromState) as string) ?? "").toLowerCase().trim();
    if (q) {
      filteredRows = filteredRows.filter((row) =>
        visibleFields.some((f) =>
          String(row[f.name] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }
  }

  // Phase V: row click → set state. Khi multiSelect=true, toggle id trong mảng.
  const selectedRaw = selectionStateKey ? pageState.get(selectionStateKey) : undefined;
  const selectedIds: unknown[] = Array.isArray(selectedRaw) ? selectedRaw : [];
  const selectedId = selectionStateKey && !multiSelect ? selectedRaw : undefined;

  const onRowClick =
    selectionStateKey || selectionEmits
      ? (row: Record<string, unknown>) => {
          // selectionEmits: lưu thêm giá trị field khác của dòng vào state (vd
          // ketcau → selKetcau) để widget khác ẩn/hiện theo (visibleWhen).
          if (selectionEmits) {
            for (const [k, f] of Object.entries(selectionEmits)) pageState.set(k, row[f] ?? "");
          }
          if (!selectionStateKey) return;
          // selectionField: lưu giá trị 1 field nghiệp vụ (vd masp) thay vì id uuid
          // — để list khác filterFromState theo cột nghiệp vụ (vd tr_dinhmuc_son.masp).
          const id = selectionField ? row[selectionField] : (row.id ?? row.ID ?? row._id);
          if (id == null) return;
          if (multiSelect) {
            const strId = String(id);
            const cur = Array.isArray(selectedRaw) ? (selectedRaw as unknown[]) : [];
            const already = cur.some((x) => String(x) === strId);
            pageState.set(
              selectionStateKey,
              already ? cur.filter((x) => String(x) !== strId) : [...cur, id],
            );
          } else {
            pageState.set(selectionStateKey, id);
          }
        }
      : undefined;

  const isRowSelected = selectionStateKey
    ? (row: Record<string, unknown>) => {
        const id = selectionField ? row[selectionField] : (row.id ?? row.ID ?? row._id);
        if (id == null) return false;
        if (multiSelect) return selectedIds.some((x) => String(x) === String(id));
        return id === selectedId || String(id) === String(selectedId);
      }
    : undefined;

  const fieldColumns = visibleFields.map((f) => ({
    accessorKey: f.name,
    header: columnLabels?.[f.name] ?? f.label,
    meta: {
      techName: f.name,
      ...(f.type === "number" || f.type === "integer" || f.type === "currency"
        ? { summary: "sum" as const }
        : { noSummary: true }),
    },
    cell: (c: { getValue: () => unknown; row: { original: Record<string, unknown> } }) => {
      const raw = c.getValue();
      const vmap = valueLabels?.[f.name];
      if (vmap && raw != null && vmap[String(raw)] != null) return vmap[String(raw)];
      const s = raw == null ? "" : String(raw);
      if (
        f.type === "image" &&
        (s.startsWith("data:image/") ||
          s.startsWith("/files/img/") ||
          s.startsWith("/f/") ||
          /^https?:\/\//.test(s))
      ) {
        return <ImageCell url={s} className="h-7 max-w-[90px] object-contain mx-auto" />;
      }
      if (f.type === "file" && (s.startsWith("/files/doc/") || s.startsWith("/f/"))) {
        return <FileCell url={s} />;
      }
      if (f.type === "boolean" || f.type === "bool") {
        const initialChecked =
          raw === true || s === "true" || s === "1" || s.toLowerCase() === "có";
        const rowId = c.row.original.id;
        return (
          <BooleanCell
            initialChecked={initialChecked}
            canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
            onSave={async (val) => {
              if (!rowId) return;
              if (isDataSource) await dataUpdate(String(rowId), { [f.name]: String(val) });
              else await api.updateRecord(String(rowId), { [f.name]: String(val) });
            }}
          />
        );
      }
      return applyFieldFormat(f, raw);
    },
  }));

  // Cột TÍNH read-only (derivedColumns): % chênh lệch giữa 2 cột số (vd % tăng/
  // giảm giá = (giá mới − giá cũ)/giá cũ × 100). Tăng → đỏ, giảm → xanh.
  const derivedFieldColumns = (derivedColumns ?? []).map((dc) => ({
    accessorKey: dc.field,
    header: columnLabels?.[dc.field] ?? dc.label ?? dc.field,
    enableSorting: false,
    meta: { techName: dc.field, noSummary: true as const },
    cell: (c: { row: { original: Record<string, unknown> } }) => {
      const row = c.row.original;
      const from = Number(row[dc.from]);
      const to = Number(row[dc.to]);
      if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) {
        return <span className="block text-right text-muted">—</span>;
      }
      const pct = ((to - from) / from) * 100;
      const cls = pct > 0 ? "text-danger" : pct < 0 ? "text-success" : "text-muted";
      const sign = pct > 0 ? "+" : "";
      return (
        <span className={`block text-right tabular-nums ${cls}`}>
          {sign}
          {pct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
        </span>
      );
    },
  }));

  const checkboxCol =
    multiSelect && selectionStateKey
      ? [
          {
            id: "__select__",
            header: () => null,
            size: 36,
            cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
              const id = row.original.id ?? row.original.ID ?? row.original._id;
              const checked = id != null && selectedIds.some((x) => String(x) === String(id));
              return (
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 mx-auto ${checked ? "bg-accent border-accent" : "border-border"}`}
                >
                  {checked && <I.Check size={9} className="text-white" />}
                </span>
              );
            },
          },
        ]
      : [];

  // Cột "Hành động" theo dòng: nút Xem (read-only) + Sửa (editable) → mở dialog
  // record con lọc theo parentField. stopPropagation để không kích hoạt row-click.
  const actionCol = rowDetail
    ? [
        {
          id: "__rowactions__",
          // Header chuỗi (không bọc hàm) → "Chọn cột hiển thị" hiện đúng "Hành động".
          header: "Hành động",
          size: 96,
          enableSorting: false,
          cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
            const pv = row.original[rowDetail.parentField];
            const rid = row.original.id ?? row.original.ID ?? row.original._id;
            return (
              <div className="flex items-center gap-1 justify-center">
                {/* editForm có cấu hình → Xem mở dialog master+detail read-only;
                    không thì giữ hành vi cũ (xem danh sách dòng con). */}
                <button
                  type="button"
                  title="Xem chi tiết"
                  className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editForm && rid != null) setEditModal({ id: String(rid), readOnly: true });
                    else setDetailModal({ value: pv, editable: false });
                  }}
                >
                  <I.Eye size={14} />
                </button>
                {/* editForm có cấu hình → nút Sửa mở dialog master+detail mới;
                    không thì giữ hành vi cũ (sửa inline dòng con). */}
                <button
                  type="button"
                  title={editForm ? "Sửa đơn hàng" : "Sửa chi tiết"}
                  className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editForm && rid != null) setEditModal({ id: String(rid), readOnly: false });
                    else setDetailModal({ value: pv, editable: true });
                  }}
                >
                  <I.Edit size={14} />
                </button>
              </div>
            );
          },
        },
      ]
    : [];

  // Cột nút "Sửa đơn" độc lập — CHỈ khi có editForm mà KHÔNG có rowDetail
  // (có rowDetail thì nút Sửa trong cột Hành động đã mở dialog edit này).
  const editFormCol =
    editForm && entityId && !rowDetail
      ? [
          {
            id: "__editform__",
            header: "Hành động",
            size: 84,
            enableSorting: false,
            cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
              const rid = row.original.id ?? row.original.ID ?? row.original._id;
              if (rid == null) return null;
              return (
                <div
                  className="flex items-center justify-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Xem thông tin"
                    className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                    onClick={() => setEditModal({ id: String(rid), readOnly: true })}
                  >
                    <I.Eye size={14} />
                  </button>
                  <button
                    type="button"
                    title="Sửa thông tin"
                    className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                    onClick={() => setEditModal({ id: String(rid), readOnly: false })}
                  >
                    <I.Edit size={14} />
                  </button>
                  {editForm.showDelete && entityId && (
                    <button
                      type="button"
                      title="Xoá"
                      className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger"
                      onClick={async () => {
                        const ok = await dialog.confirm("Xoá đơn hàng này?", {
                          title: "Xác nhận xoá",
                          danger: true,
                        });
                        if (!ok) return;
                        try {
                          await api.deleteRecord(String(rid));
                          pageState.set(`__refresh:${entityId}`, Date.now());
                        } catch (e) {
                          await dialog.alert(
                            `Không thể xoá.\n\nChi tiết: ${(e as Error).message}`,
                            { title: "Thao tác thất bại" },
                          );
                        }
                      }}
                    >
                      <I.Trash size={14} />
                    </button>
                  )}
                </div>
              );
            },
          },
        ]
      : [];

  // Cột ẩn cho sort hệ thống (không hiện ra UI) — cho phép defaultSort theo created_at/updated_at.
  const systemHiddenCols: ColumnDef<Record<string, unknown>>[] = [
    {
      id: "created_at",
      accessorKey: "created_at",
      enableHiding: false,
      size: 0,
      header: () => null,
      cell: () => null,
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      enableHiding: false,
      size: 0,
      header: () => null,
      cell: () => null,
    },
  ];

  const columns = [
    ...editFormCol,
    ...rowActionCol,
    ...actionCol,
    ...checkboxCol,
    ...fieldColumns,
    ...derivedFieldColumns,
    ...systemHiddenCols,
  ];

  // Hàm lưu 1 record (dùng cho editable và excelMode). Datasource → ghi qua
  // resolver (base field về record gốc), entity → records.update trực tiếp.
  const saveRecord = async (rowId: unknown, changes: Record<string, unknown>) => {
    if (isDataSource) await dataUpdate(String(rowId), changes);
    else await api.updateRecord(String(rowId), changes);
    // Cột phụ thuộc tính ở server (trigger): vd đổi % → diện tích sơn tính lại.
    // Nạp lại lưới để hiện giá trị mới (chỉ khi cấu hình bật refetchOnSave).
    if (refetchOnSave) {
      pageState.set(
        isDataSource ? `__refresh:ds:${dataSourceId}` : `__refresh:${entityId}`,
        Date.now(),
      );
    }
  };
  // Bulk + dry-run validate cho batch edit — chỉ entity-backed.
  const editBatchOps: BatchOps | undefined =
    !isDataSource && entityId
      ? {
          validate: (items) => api.bulkValidateRecords(entityId, items).then((r) => r.results),
          bulkUpdate: (ids, patch) => api.bulkUpdateRecords(entityId, ids, patch),
        }
      : undefined;

  // ── Chế độ bảng tính Excel ──────────────────────────────────────────
  if (excelMode) {
    return (
      <div className="h-full flex flex-col">
        {loading && (
          <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
            <I.Table size={11} />
            {title ?? ent?.name ?? "List"}
            <span className="ml-auto">{t("widget.loading")}</span>
          </div>
        )}
        {err && <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>}
        {!err && !loading && (
          <div className="flex-1 min-h-0">
            <ExcelGrid
              fields={visibleFields}
              rows={filteredRows}
              batchEdit={batchEdit}
              onSave={saveRecord}
              onRowClick={onRowClick}
              isRowSelected={isRowSelected}
            />
          </div>
        )}
      </div>
    );
  }

  // Khi loadGate chưa mở → hiện hint thay vì "Chưa có bản ghi nào."
  const gateKey = loadGate?.trim();
  const gateVal = gateKey ? pageState.get(gateKey) : undefined;
  const gateClosed =
    !!gateKey &&
    (gateVal === undefined ||
      gateVal === null ||
      gateVal === "" ||
      (Array.isArray(gateVal) && gateVal.length === 0));
  const emptyTextResolved = gateClosed ? t("widget.gate_hint") : t("widget.empty_records");

  // ── Chế độ chỉnh sửa inline ─────────────────────────────────────────
  if (editable || (editableFields && editableFields.length > 0)) {
    return (
      <EditableListWidget
        ent={ent}
        title={title}
        loading={loading}
        err={err}
        filteredRows={filteredRows}
        visibleFields={visibleFields}
        columnLabels={columnLabels}
        batchEdit={!!batchEdit}
        editableFields={editableFields}
        highlightEmptyFields={highlightEmptyFields}
        computedColumns={computedColumns}
        derivedColumns={derivedColumns}
        onSave={saveRecord}
        batchOps={editBatchOps}
        onRowClick={onRowClick}
        isRowSelected={isRowSelected}
        columnGroups={columnGroups}
        onBulkCreate={bulkCreate}
        createDefaults={createDefaults}
        stateKey={stateKey}
        rowActions={effectiveRowActions}
        selectable={selectable}
        rowActionsHidden={rowActionsHidden}
        rowActionsStyle={rowActionsStyle}
        refFill={refFill}
        addRowAtEnd={addRowAtEnd}
        addRowPos={addRowPos}
        embeddedActions={embeddedActions}
        emptyText={emptyTextResolved}
        gateClosed={gateClosed}
      />
    );
  }

  // ── Chế độ mặc định (read-only) ─────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {(createForm ||
        (embeddedActions && embeddedActions.length > 0) ||
        (_embeddedFilters && _embeddedFilters.length > 0)) && (
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
          {createForm && !createForm.embedded && (
            <Button
              variant="primary"
              icon={<I.Plus size={13} />}
              onClick={() => setCreateOpen(true)}
            >
              {createForm.title ?? "Thêm mới đơn hàng"}
            </Button>
          )}
          {embeddedActions?.map((item) => (
            <ActionWidget
              key={item.id}
              config={item}
              pageState={pageState}
              inline
              onOpenCreateForm={createForm ? () => setCreateOpen(true) : undefined}
            />
          ))}
          {_embeddedFilters?.map((ef) => {
            const opts = (ef.options ?? "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean);
            const cur = (pageState.get(ef.stateKey) as string) ?? "";
            return (
              <label key={ef.stateKey} className="flex items-center gap-1 text-xs text-muted">
                {ef.label && <span className="shrink-0">{ef.label}:</span>}
                <select
                  value={cur}
                  onChange={(e) => pageState.set(ef.stateKey, e.target.value)}
                  className="input text-xs py-0.5 px-1.5 h-auto min-w-[100px]"
                >
                  <option value="">Tất cả</option>
                  {opts.map((o) => (
                    <option key={o} value={o}>
                      {ef.optionLabels?.[o] ?? o}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {err ? (
          <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
        ) : gateClosed && filteredRows.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-sm text-muted">{t("widget.gate_hint")}</span>
          </div>
        ) : (
          <DataGrid
            toolbar
            label={title ?? ent?.name ?? "List"}
            data={filteredRows}
            columns={columns}
            columnGroups={columnGroups}
            defaultGrouping={defaultGrouping}
            emptyText={filterFromState ? t("widget.select_master") : t("widget.empty_records")}
            stateKey={stateKey}
            onRowClick={onRowClick}
            isRowSelected={isRowSelected}
            globalFilter={clientSearchVal}
            onGlobalFilterChange={
              effectiveSearchStateKey
                ? (v: string) => pageState.set(effectiveSearchStateKey, v)
                : undefined
            }
            pageSize={pageSize}
            defaultSort={defaultSort}
            enableSelection={selectable}
            onExportAll={
              entityId && !isDataSource
                ? async (format) => {
                    const r = await api.exportRecords(entityId, "csv");
                    const name = title ?? ent?.name ?? "export";
                    if (format === "xlsx") {
                      await exportCsvContentAsXlsx(r.content, name);
                    } else {
                      const blob = new Blob([r.content], { type: "text/csv;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${name}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }
                : undefined
            }
          />
        )}
      </div>
      {rowDetail && detailModal && (
        <Modal
          open
          onClose={() => setDetailModal(null)}
          title={`${rowDetail.title ?? "Chi tiết"}${
            detailModal.value != null ? ` — ${String(detailModal.value)}` : ""
          }${detailModal.editable ? " (Sửa)" : ""}`}
          width={960}
          footer={
            <Button variant="ghost" onClick={() => setDetailModal(null)}>
              Đóng
            </Button>
          }
        >
          <div className="h-[460px]">
            <ListWidget
              entityId={rowDetail.entity}
              fields={rowDetail.fields}
              columnLabels={rowDetail.columnLabels}
              loadFilters={{ [rowDetail.childField]: { op: "=", value: detailModal.value } }}
              editable={detailModal.editable}
              rowLimit={1000}
              pageSize={50}
            />
          </div>
        </Modal>
      )}
      {createForm && createOpen && (
        <MasterDetailCreateModal
          config={createForm}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            const stamp = Date.now();
            pageState.set(`__refresh:${createForm.master.entity}`, stamp);
            pageState.set(`__refresh:${createForm.detail.entity}`, stamp);
          }}
        />
      )}
      {editForm && editModal && (
        <MasterDetailEditModal
          config={editForm}
          recordId={editModal.id}
          readOnly={editModal.readOnly}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            const stamp = Date.now();
            pageState.set(`__refresh:${editForm.master.entity}`, stamp);
            pageState.set(`__refresh:${editForm.detail.entity}`, stamp);
          }}
        />
      )}
    </div>
  );
}
