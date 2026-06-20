/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget list/chart/kanban truy vấn
   RECORD THẬT của entity bound (qua ApiDataSource); widget form
   ghi record thật vào backend. KHÔNG còn dữ liệu giả.
   ========================================================== */

import { useBlocker } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactElement } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import {
  clearPersonalLayoutLS,
  exportCsvContentAsXlsx,
  layoutStorageKey,
  loadPersonalLayout,
  savePersonalLayoutLS,
} from "@/components/renderer/consumer-utils";
import {
  type ColumnGroupNode,
  DataGrid,
  type ServerPagingController,
} from "@/components/renderer/DataGrid";
import { DocumentWidget } from "@/components/renderer/DocumentWidget";
import { DrawingPageCell } from "@/components/renderer/DrawingPageCell";
import { fmtDateCell, fromDateInput, toDateInput } from "@/components/renderer/date-cell-utils";
import { ExcelGrid } from "@/components/renderer/ExcelGrid";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import {
  type CreateFormCfg,
  MasterDetailCreateModal,
} from "@/components/renderer/MasterDetailCreateModal";
import { MasterDetailEditModal } from "@/components/renderer/MasterDetailEditModal";
import {
  api,
  PageStateProvider,
  useEntity,
  usePageState,
  useServerPagedRecords,
  useWidgetData,
} from "@/components/renderer/page-data";
import type {
  ActionBarItem,
  AggSpec,
  EmbeddedFilter,
  LoadFilters,
  PageComponent,
  RefFillResult,
  RowDetailCfg,
  SplitGridCell,
  SplitPanelCfg,
  VisibleRule,
} from "@/components/renderer/page-types";
import { RowActionsCell } from "@/components/renderer/RowActionsCell";
import { FilterWidget } from "@/components/renderer/widgets/FilterWidget";
import { DetailWidget, FormWidget } from "@/components/renderer/widgets/FormDetailWidget";
import {
  ComboboxWidget,
  ListboxWidget,
  SearchWidget,
  TagboxWidget,
} from "@/components/renderer/widgets/input-widgets";
import {
  CalendarWidget,
  ChartWidget,
  KanbanWidget,
  KpiWidget,
  MapWidget,
  PivotWidget,
  StepWidget,
} from "@/components/renderer/widgets/viz-widgets";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import { Button, Modal, SearchableSelect } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { applyFieldFormat } from "@/lib/format";
import type { EntityField } from "@/lib/object-types";
import { applyFilters } from "@/lib/page-filters";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { idbGet, idbSet } from "@/lib/page-state-idb";
import { fieldCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useRbac } from "@/stores/rbac";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, FilterNode } from "@/types/page";

/* ── Date/DateTime trong ô grid ──────────────────────────────────────────
   Giá trị lưu = chuỗi ISO (datetime, vd "2020-03-10T12:41:21Z") hoặc YYYY-MM-DD
   (date). Hiển thị gọn dd/MM/yyyy [HH:mm] theo giờ địa phương; sửa bằng input
   date / datetime-local; lưu lại ISO (datetime) / YYYY-MM-DD (date) để
   validate-on-write chuẩn hoá. Chuỗi KHÔNG parse được → giữ nguyên (không vỡ). */

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
  if (isImage && str.startsWith("data:image/")) {
    return (
      <img
        src={str}
        alt=""
        className="h-6 max-w-[120px] object-contain mx-auto py-0.5"
        loading="lazy"
      />
    );
  }
  // Bool: checkbox bấm thẳng (không cần double-click). stopPropagation để khỏi
  // chọn dòng. Chỉ ghi khi có quyền.
  if (isBoolean) {
    const checked = value === true || str === "true" || str === "1";
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
      next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), [field]: value });
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
            refEntityId={(f as { ref?: string }).ref}
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
    // Cột ✕ RIÊNG để bỏ dòng MỚI nháp — CHỈ khi lưới KHÔNG có cột hành động.
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
    rbacRole,
    myGroupIds,
    newRows.length,
    rowActions,
    pageState,
    title,
    rowActionsHidden,
    rowActionsStyle,
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
      ) : (
        <div className="flex-1 min-h-0">
          {/* Lưới đầy đủ chức năng (sort/filter/group/summary/export/resize/
              reorder/chooser) — ô sửa inline qua EditableCell trong column.cell. */}
          <DataGrid
            columns={columns}
            columnGroups={columnGroups}
            data={displayData}
            emptyText={t("widget.empty_records")}
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
function ServerPagedListWidget({
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
                refEntityId={(f as { ref?: string }).ref}
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
              if (f.type === "image" && s.startsWith("data:image/"))
                return (
                  <img
                    src={s}
                    alt=""
                    className="h-6 max-w-[120px] object-contain mx-auto py-0.5"
                    loading="lazy"
                  />
                );
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
  return {
    ...action,
    steps: action.steps.map((s) =>
      s.kind === "open-popup" ||
      s.kind === "delete-record" ||
      s.kind === "open-wizard" ||
      s.kind === "update-fields" ||
      s.kind === "update-record"
        ? { ...s, recordIdBinding: { source: "const" as const, value: rowId } }
        : s,
    ),
  };
}

/** Widget "list" — bảng record thật, cột suy từ field của entity. */
function ListWidget({
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
  const [editModal, setEditModal] = useState<{ id: string; readOnly: boolean } | null>(null);
  const [detailModal, setDetailModal] = useState<{ value: unknown; editable: boolean } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const {
    rows,
    loading,
    err,
    fields: dataFields,
    isDataSource,
    update: dataUpdate,
    create: dataCreate,
    refFill,
  } = useWidgetData({ entity: entityId, dataSourceId, rowLimit, loadFilters, loadGate });
  const pageState = usePageState();
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
    if (!rowActionsBuiltin) return []; // master switch OFF → ẩn cột hành động hoàn toàn
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
  if (searchFromState) {
    const q = ((pageState.get(searchFromState) as string) ?? "").toLowerCase().trim();
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
    // Header DQHF per-page (columnLabels) ưu tiên hơn label DataSource global.
    header: columnLabels?.[f.name] ?? f.label,
    // Tên cột kỹ thuật hiện mono dưới nhãn ở header (DataGrid đọc meta.techName).
    // Tổng (Σ) chỉ cho cột SỐ theo kiểu field — cột chữ (vd Hiệu ứng) lỡ chứa
    // số cũng KHÔNG bị auto cộng (noSummary).
    meta: {
      techName: f.name,
      ...(f.type === "number" || f.type === "integer" || f.type === "currency"
        ? { summary: "sum" as const }
        : { noSummary: true }),
    },
    cell: (c: { getValue: () => unknown }) => {
      const raw = c.getValue();
      // Map value→label per-page (vd Phân loại: TRONG → "Màu trong").
      const vmap = valueLabels?.[f.name];
      if (vmap && raw != null && vmap[String(raw)] != null) return vmap[String(raw)];
      // Field ảnh: render thumbnail nếu là data:image hoặc URL http(s).
      const s = raw == null ? "" : String(raw);
      if (f.type === "image" && (s.startsWith("data:image/") || /^https?:\/\//.test(s))) {
        return (
          <img src={s} alt="" className="h-7 max-w-[90px] object-contain mx-auto" loading="lazy" />
        );
      }
      return applyFieldFormat(f, raw);
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
                </div>
              );
            },
          },
        ]
      : [];

  const columns = [...editFormCol, ...rowActionCol, ...actionCol, ...checkboxCol, ...fieldColumns];

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

  // ── Chế độ chỉnh sửa inline ─────────────────────────────────────────
  if (editable) {
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
      />
    );
  }

  // ── Chế độ mặc định (read-only) ─────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {(createForm || (embeddedActions && embeddedActions.length > 0)) && (
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
          {createForm && (
            <Button
              variant="primary"
              icon={<I.Plus size={13} />}
              onClick={() => setCreateOpen(true)}
            >
              {createForm.title ?? "Thêm mới đơn hàng"}
            </Button>
          )}
          {embeddedActions?.map((item) => (
            <ActionWidget key={item.id} config={item} pageState={pageState} inline />
          ))}
        </div>
      )}
      {loading && (
        <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
          <I.Table size={11} />
          {title ?? ent?.name ?? "List"}
          <span className="ml-auto">{t("widget.loading")}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {err ? (
          <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
        ) : (
          <DataGrid
            toolbar={!loading}
            label={title ?? ent?.name ?? "List"}
            data={filteredRows}
            columns={columns}
            columnGroups={columnGroups}
            defaultGrouping={defaultGrouping}
            emptyText={filterFromState ? t("widget.select_master") : t("widget.empty_records")}
            stateKey={stateKey}
            onRowClick={onRowClick}
            isRowSelected={isRowSelected}
            globalFilter={
              searchStateKey ? ((pageState.get(searchStateKey) as string) ?? "") : undefined
            }
            onGlobalFilterChange={
              searchStateKey ? (v: string) => pageState.set(searchStateKey, v) : undefined
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

/** Drag-resize cho N panel: mảng ratios + onHandleDrag(index, e) cho từng thanh ngăn */
function useSplitRatios(
  initRatios: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  axis: "h" | "v",
) {
  const [ratios, setRatios] = useState(() => [...initRatios]);
  const onHandleDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    const start = axis === "h" ? e.clientX : e.clientY;
    const snap = [...ratios];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const size = axis === "h" ? rect.width : rect.height;
      const delta = (((axis === "h" ? ev.clientX : ev.clientY) - start) / size) * total;
      const min = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i] = Math.max(min, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i + 1] = Math.max(min, snap[i]! + snap[i + 1]! - next[i]!);
      setRatios(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return { ratios, onHandleDrag };
}

/** Drag-resize cho grid N×M: trả colFr/rowFr local + handler mousedown cho mỗi thanh ngăn */
function useGridDrag(
  initColFr: number[],
  initRowFr: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [colFr, setColFr] = useState(() => [...initColFr]);
  const [rowFr, setRowFr] = useState(() => [...initRowFr]);

  const onColDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const snap = [...colFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const cw = containerRef.current?.getBoundingClientRect().width ?? 0;
      if (!cw) return;
      const delta = ((ev.clientX - startX) / cw) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i] = Math.max(minFr, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i + 1] = Math.max(minFr, snap[i]! + snap[i + 1]! - next[i]!);
      setColFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onRowDrag = (j: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const snap = [...rowFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const ch = containerRef.current?.getBoundingClientRect().height ?? 0;
      if (!ch) return;
      const delta = ((ev.clientY - startY) / ch) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j] = Math.max(minFr, snap[j]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j + 1] = Math.max(minFr, snap[j]! + snap[j + 1]! - next[j]!);
      setRowFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return { colFr, rowFr, onColDrag, onRowDrag };
}

/**
 * panelKey: "a"|"b"|"c"|"d" khi gọi từ SplitWidget — mỗi panel có key riêng để
 * các panel khác có thể lọc độc lập. Bỏ qua (undefined) khi gọi từ GridWidget
 * để giữ hành vi cũ (dùng chung splitKey).
 */
function buildSubCfg(
  panel: SplitPanelCfg,
  splitKey: string,
  panelKey?: string,
): Record<string, unknown> {
  const kind = panel.kind ?? "list";
  // Với split widget: mỗi panel dùng key riêng; grid widget dùng splitKey chung.
  const ownStateKey = panelKey ? `${splitKey}:${panelKey}` : splitKey;
  const srcStateKey = panelKey
    ? `${splitKey}:${(panel.filterFromPanel ?? "a").toUpperCase()}`
    : splitKey;
  return {
    entity: panel.entity,
    dataSourceId: panel.dataSourceId,
    title: panel.title,
    fields: panel.fields,
    columnLabels: panel.columnLabels,
    columnGroups: panel.columnGroups,
    serverPaging: panel.serverPaging,
    editable: panel.editable,
    batchEdit: panel.batchEdit,
    excelMode: panel.excelMode,
    multiSelect: panel.multiSelect,
    loadGate: panel.loadGate,
    loadFilters: panel.loadFilters,
    rowLimit: panel.rowLimit,
    pageSize: panel.pageSize,
    defaultSort: panel.defaultSort,
    embeddedActions: panel.embeddedActions,
    rowActionsBuiltin: panel.rowActionsBuiltin,
    rowActionsHidden: panel.rowActionsHidden,
    rowActionsStyle: panel.rowActionsStyle,
    rowActions: panel.rowActions,
    createForm: panel.createForm,
    editForm: panel.editForm,
    selectable: panel.selectable,
    addRowAtEnd: panel.addRowAtEnd,
    addRowPos: panel.addRowPos,
    groupBy: panel.groupBy,
    valueField: panel.valueField,
    // chart kind maps to cfg.kind (ChartWidget reads cfg.kind for bar/line/pie…)
    ...(kind === "chart" ? { kind: panel.chartKind ?? "bar" } : {}),
    ...(kind === "list"
      ? {
          selectionStateKey: ownStateKey,
          ...(panel.sourceField ? { selectionField: panel.sourceField } : {}),
          // sourceFields: mỗi field phát thêm 1 state key riêng {ownStateKey}:{field}
          ...(panel.sourceFields?.length
            ? {
                selectionEmits: Object.fromEntries(
                  panel.sourceFields.map((f) => [`${ownStateKey}:${f}`, f]),
                ),
              }
            : {}),
        }
      : {}),
    ...(kind === "detail" ? { recordIdFromState: srcStateKey } : {}),
    // linkField đơn (backwards compat) → filterFromState như cũ.
    // Bỏ qua khi linkConditions đã khai báo: linkConditions ưu tiên + filterFromState
    // sẽ dùng row-id (uuid) làm stateKey → không bao giờ khớp field nghiệp vụ → ẩn hết.
    ...((kind === "list" || kind === "chart" || kind === "kanban") &&
    panel.linkField &&
    !panel.linkConditions?.length
      ? { filterFromState: { field: panel.linkField, stateKey: srcStateKey } }
      : {}),
    // linkConditions: mảng điều kiện AND — fromField → key phụ; bỏ fromField → key chính
    ...((kind === "list" || kind === "chart" || kind === "kanban") && panel.linkConditions?.length
      ? {
          filterConditions: panel.linkConditions.map((c) => {
            const fp = (c.fromPanel ?? panel.filterFromPanel ?? "a").toUpperCase();
            const fromStateKey = panelKey
              ? c.fromField
                ? `${splitKey}:${fp}:${c.fromField}`
                : `${splitKey}:${fp}`
              : splitKey;
            return { field: c.toField, stateKey: fromStateKey };
          }),
        }
      : {}),
    ...(kind === "form" && panel.linkField
      ? { linkedToState: { field: panel.linkField, stateKey: srcStateKey } }
      : {}),
  };
}

function RenderSubWidget({
  kind,
  cfg,
  stateKey,
}: {
  kind: string;
  cfg: Record<string, unknown>;
  stateKey: string;
}) {
  const pageState = usePageState();
  const embeddedActions = (cfg.embeddedActions ?? []) as ActionBarItem[];

  // Split widget lồng nhau bên trong tab panel — dùng stateKey làm id để namespace state
  if (kind === "split") {
    const fakeComp: PageComponent = {
      id: stateKey.replace(/[^a-zA-Z0-9_]/g, "_"),
      kind: "split",
      x: 0,
      y: 0,
      w: 12,
      h: 12,
      config: cfg,
    };
    return <SplitWidget comp={fakeComp} />;
  }

  if (kind === "list") {
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return withEmbeddedActions(
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />,
        embeddedActions,
        pageState,
      );
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
        searchFromState={cfg.searchFromState as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
      />,
      embeddedActions,
      pageState,
    );
  }
  if (kind === "detail")
    return withEmbeddedActions(<DetailWidget cfg={cfg} />, embeddedActions, pageState);
  if (kind === "form")
    return withEmbeddedActions(<FormWidget cfg={cfg} />, embeddedActions, pageState);
  if (kind === "chart") return <ChartWidget cfg={cfg} />;
  if (kind === "kanban") return <KanbanWidget cfg={cfg} />;
  return null;
}

/** Grid Layout N×M — kind="grid", config.cells[]; có drag handle giữa cột/hàng */
function GridWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;
  const cols = (cfg.cols as number) || 2;
  const rows = (cfg.rows as number) || 1;
  const cells = (cfg.cells as SplitGridCell[]) ?? [];
  const gridLabel = cfg.label as string | undefined;

  // Normalize fr arrays to match col/row count
  const savedColFr = cfg.colFr as number[] | undefined;
  const savedRowFr = cfg.rowFr as number[] | undefined;
  const initColFr: number[] = Array.from({ length: cols }, (_, i): number => savedColFr?.[i] ?? 1);
  const initRowFr: number[] = Array.from({ length: rows }, (_, j): number => savedRowFr?.[j] ?? 1);

  const containerRef = useRef<HTMLDivElement>(null);
  const { colFr, rowFr, onColDrag, onRowDrag } = useGridDrag(
    initColFr,
    initRowFr,
    containerRef as React.RefObject<HTMLDivElement | null>,
  );

  // Template interleaves content fr tracks with 4px handle tracks
  // e.g. cols=3: "1fr 4px 1fr 4px 1fr"
  const colTemplate = colFr.map((f, i) => (i < cols - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");
  const rowTemplate = rowFr.map((f, j) => (j < rows - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");

  // Content col c → display col (c-1)*2+1; colSpan s → display span s*2-1
  const cellStyle = (cell: SplitGridCell) => ({
    gridColumn: `${(cell.col - 1) * 2 + 1} / span ${cell.colSpan * 2 - 1}`,
    gridRow: `${(cell.row - 1) * 2 + 1} / span ${cell.rowSpan * 2 - 1}`,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {gridLabel && (
        <div className="px-3 py-1.5 border-b border-border/40 shrink-0 text-sm font-medium">
          {gridLabel}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
      >
        {/* Handles rendered BEFORE cells — merged cells sit on top via DOM stacking order */}
        {Array.from({ length: cols - 1 }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn cột — index ổn định
            key={`ch-${i}`}
            className="cursor-col-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `${(i + 1) * 2}`,
              gridRow: `1 / span ${rows * 2 - 1}`,
            }}
            onMouseDown={(e) => onColDrag(i, e)}
          />
        ))}
        {Array.from({ length: rows - 1 }, (_, j) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn hàng — index ổn định
            key={`rh-${j}`}
            className="cursor-row-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `1 / span ${cols * 2 - 1}`,
              gridRow: `${(j + 1) * 2}`,
            }}
            onMouseDown={(e) => onRowDrag(j, e)}
          />
        ))}
        {/* Content cells — rendered last, on top of handle divs */}
        {cells.map((cell) => {
          const kind = cell.kind ?? "list";
          const cellCfg = buildSubCfg(cell as SplitPanelCfg, splitKey);
          return (
            <div key={cell.id} className="overflow-hidden" style={cellStyle(cell)}>
              {cell.entity || cell.dataSourceId ? (
                <RenderSubWidget kind={kind} cfg={cellCfg} stateKey={`${comp.id}:${cell.id}`} />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted/50">
                  Chưa bind
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SplitWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;
  const pageState = usePageState();
  const tabStateKey = cfg.tabStateKey as string | undefined;

  const orientation = (cfg.orientation as string) ?? "h";
  const count = Math.max(2, Math.min(3, (cfg.count as number) ?? 2));
  const isTabs = orientation === "tabs";
  const isBoth = orientation === "both";
  const isBoth2 = orientation === "both2";
  const isBoth3 = orientation === "both3";
  const isBoth4 = orientation === "both4";
  const isBoth5 = orientation === "both5";
  const isH =
    !isBoth && !isBoth2 && !isBoth3 && !isBoth4 && !isBoth5 && !isTabs && orientation !== "v";

  const panelA = (cfg.panelA as SplitPanelCfg | undefined) ?? {};
  const panelB = (cfg.panelB as SplitPanelCfg | undefined) ?? {};
  const panelC = (cfg.panelC as SplitPanelCfg | undefined) ?? {};
  const panelD = (cfg.panelD as SplitPanelCfg | undefined) ?? {};
  const kindA = panelA.kind ?? "list";
  const kindB = panelB.kind ?? "detail";
  const kindC = panelC.kind ?? "list";
  const kindD = panelD.kind ?? "list";
  const cfgA = buildSubCfg({ ...panelA, kind: kindA, linkField: undefined }, splitKey, "a");
  const cfgB = buildSubCfg({ ...panelB, kind: kindB }, splitKey, "b");
  const cfgC = buildSubCfg({ ...panelC, kind: kindC }, splitKey, "c");
  const cfgD = buildSubCfg({ ...panelD, kind: kindD }, splitKey, "d");

  // Ratios — initialized from saved config, adjusted by drag at runtime only
  const savedRatios = cfg.splitRatios as number[] | undefined;
  const initRatioH = (cfg.ratio as number) ?? 40;
  const initRatioV = (cfg.ratioV as number) ?? 50;
  const initRatioV2 = (cfg.ratioV2 as number) ?? 50;
  const panelCount = isBoth || isBoth2 || isBoth3 || isBoth4 || isBoth5 ? 2 : count;
  const initMain = savedRatios ?? (panelCount >= 3 ? [33, 33, 34] : [initRatioH, 100 - initRatioH]);
  const initBothV = [initRatioV, 100 - initRatioV];
  const initBothV2 = [initRatioV2, 100 - initRatioV2];

  // All hooks unconditional (React rules)
  const containerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rightRef2 = useRef<HTMLDivElement>(null);
  const subRowRef = useRef<HTMLDivElement>(null);
  const subRowRef2 = useRef<HTMLDivElement>(null);
  const mainRef = containerRef as React.RefObject<HTMLDivElement | null>;
  const bvRef = rightRef as React.RefObject<HTMLDivElement | null>;
  const bvRef2 = rightRef2 as React.RefObject<HTMLDivElement | null>;
  const bhRef = subRowRef as React.RefObject<HTMLDivElement | null>;
  const bhRef2 = subRowRef2 as React.RefObject<HTMLDivElement | null>;
  const { ratios: mainR, onHandleDrag: onMainDrag } = useSplitRatios(
    initMain,
    mainRef,
    isH || isBoth || isBoth2 || isBoth3 ? "h" : "v",
  );
  const { ratios: bothVR, onHandleDrag: onBothVDrag } = useSplitRatios(initBothV, bvRef, "v");
  const { ratios: bothVR2, onHandleDrag: onBothVDrag2 } = useSplitRatios(initBothV2, bvRef2, "v");
  // both4/both5: sub-row horizontal split (reuse ratioV for ratio source)
  const { ratios: bothHR, onHandleDrag: onBothHDrag } = useSplitRatios(initBothV, bhRef, "h");
  const { ratios: bothHR2, onHandleDrag: onBothHDrag2 } = useSplitRatios(initBothV, bhRef2, "h");
  const [activeTab, setActiveTab] = useState("A");

  // Emit tab title vào pageState khi isTabs + tabStateKey được cấu hình
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ cần chạy khi mount để set giá trị ban đầu
  useEffect(() => {
    if (!tabStateKey) return;
    const rawTabPanels = cfg.tabPanels as Array<{ title?: string }> | undefined;
    const firstLabel = rawTabPanels?.[0]?.title ?? "A";
    pageState.set(tabStateKey, firstLabel);
  }, [tabStateKey]);

  const handleCls = (ax: "h" | "v") =>
    `shrink-0 ${ax === "h" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"} bg-border hover:bg-accent/50 transition-colors active:bg-accent`;

  // ── Tabs ──────────────────────────────────────────────────────────────
  if (isTabs) {
    // tabPanels array → N tabs (không giới hạn A/B/C); fallback về fixed A/B/C cũ
    const rawTabPanels = cfg.tabPanels as Array<SplitPanelCfg & { title?: string }> | undefined;
    const tabDefs = rawTabPanels?.length
      ? rawTabPanels.map((p, i) => {
          const kind = (p.kind as string) ?? "list";
          // kind="split" → pass-through raw config (panelA/panelB/orientation phải giữ nguyên)
          // Các kind khác → buildSubCfg chuẩn hóa (thêm selectionStateKey, linkField…)
          const tabCfg =
            kind === "split"
              ? (p as unknown as Record<string, unknown>)
              : buildSubCfg({ ...p, linkField: undefined }, splitKey, String(i));
          return { key: String(i), cfg: tabCfg, kind, label: p.title ?? `Tab ${i + 1}` };
        })
      : [
          { key: "A", cfg: cfgA, kind: kindA, label: panelA.title || "A" },
          { key: "B", cfg: cfgB, kind: kindB, label: panelB.title || "B" },
          ...(count >= 3 ? [{ key: "C", cfg: cfgC, kind: kindC, label: panelC.title || "C" }] : []),
        ];
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex border-b border-border shrink-0">
          {tabDefs.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setActiveTab(p.key);
                if (tabStateKey) pageState.set(tabStateKey, p.label);
              }}
              className={cn(
                "px-4 py-2 text-sm -mb-px border-b-2 transition-colors whitespace-nowrap",
                activeTab === p.key
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {tabDefs.map((p) => (
            <div
              key={p.key}
              className="h-full overflow-hidden"
              style={{ display: activeTab === p.key ? "block" : "none" }}
            >
              <RenderSubWidget
                kind={p.kind}
                cfg={p.cfg}
                stateKey={`${comp.id}:${p.key.toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Both (A | B trên / C dưới) ────────────────────────────────────────
  if (isBoth) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both2 ((A trên / B dưới) | C) ────────────────────────────────────
  if (isBoth2) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── Both3 ((A/B) | (C/D)) ────────────────────────────────────────────
  if (isBoth3) {
    const total3 = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total3) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    const vTotal2 = bothVR2[0]! + bothVR2[1]!;
    const vPct2 = (bothVR2[0]! / vTotal2) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef2} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct2}%` }}>
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag2(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindD} cfg={cfgD} stateKey={`${comp.id}:d`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both4 (A trên / B trái dưới, C phải dưới) ────────────────────────
  if (isBoth4) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR[0]! + bothHR[1]!;
    const hPct = (bothHR[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div ref={subRowRef} className="flex flex-row flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both5 (A trái trên, B phải trên / C dưới) ─────────────────────────
  if (isBoth5) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR2[0]! + bothHR2[1]!;
    const hPct = (bothHR2[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div
          ref={subRowRef2}
          className="flex flex-row overflow-hidden"
          style={{ height: `${vPct}%` }}
        >
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag2(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── H / V (2 hoặc 3 panels) ───────────────────────────────────────────
  const flexDir = isH ? "flex-row" : "flex-col";
  const sizeKey = isH ? "width" : "height";
  const dragAxis = isH ? "h" : "v";
  const total = mainR.reduce((a, b) => a + b, 0);
  const allPanels = [
    { key: "a", cfg: cfgA, kind: kindA },
    { key: "b", cfg: cfgB, kind: kindB },
    ...(panelCount >= 3 ? [{ key: "c", cfg: cfgC, kind: kindC }] : []),
  ];

  return (
    <div ref={containerRef} className={`flex ${flexDir} h-full overflow-hidden`}>
      {allPanels.map((p, idx) => {
        const isLast = idx === allPanels.length - 1;
        const pct = ((mainR[idx] ?? 1) / total) * 100;
        return (
          <Fragment key={p.key}>
            <div
              className="overflow-hidden"
              style={isLast ? { flex: 1 } : { [sizeKey]: `${pct}%` }}
            >
              <RenderSubWidget kind={p.kind} cfg={p.cfg} stateKey={`${comp.id}:${p.key}`} />
            </div>
            {!isLast && (
              <div onMouseDown={(e) => onMainDrag(idx, e)} className={handleCls(dragAxis)} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Strip hành động nhúng bên trong widget (list/form/detail). */
/** Thanh hành động tràn → popover, dùng chung cho EmbeddedActionStrip + ActionBarWidget. */
function ActionOverflowBar({
  items,
  compact,
  justify = "justify-start",
  pageState,
  wrapClass,
}: {
  items: ActionBarItem[];
  compact: boolean;
  justify?: string;
  pageState: ReturnType<typeof usePageState>;
  wrapClass?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; right: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length + compact đủ
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const ghost = ghostRef.current;
    if (!outer || !ghost) return;

    const measure = () => {
      const avail = outer.clientWidth;
      const children = Array.from(ghost.children) as HTMLElement[];
      const moreEl = children[children.length - 1];
      const moreW = (moreEl?.offsetWidth ?? 24) + 6;
      const itemEls = children.slice(0, -1);
      if (!itemEls.length) {
        setVisibleCount(0);
        return;
      }

      const last = itemEls[itemEls.length - 1];
      if (last && last.offsetLeft + last.offsetWidth <= avail) {
        setVisibleCount(itemEls.length);
        return;
      }
      let count = 0;
      for (let i = 0; i < itemEls.length; i++) {
        const el = itemEls[i]!;
        if (el.offsetLeft + el.offsetWidth + moreW <= avail) count = i + 1;
        else break;
      }
      setVisibleCount(Math.max(1, count));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    measure();
    return () => ro.disconnect();
  }, [items.length, compact]);

  // Đóng popover khi click ngoài (check cả btn lẫn popover body)
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!moreBtnRef.current?.contains(t) && !popoverRef.current?.contains(t)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const toggleMore = () => {
    if (!moreOpen) {
      const rect = moreBtnRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverStyle({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        });
      }
    }
    setMoreOpen((v) => !v);
  };

  const visibleItems = items.slice(0, visibleCount);
  const hiddenItems = items.slice(visibleCount);

  return (
    <div ref={outerRef} className={cn("relative", wrapClass)}>
      {/* Ghost invisible để đo width thực — nằm trong outer (không overflow-hidden) */}
      <div
        ref={ghostRef}
        aria-hidden="true"
        className="absolute inset-0 flex items-center gap-1 px-2 invisible pointer-events-none"
      >
        {items.map((item) => (
          <ActionWidget
            key={item.id}
            config={item}
            pageState={pageState}
            inline
            compact={compact}
          />
        ))}
        <button type="button" className="h-6 w-6 shrink-0 rounded flex items-center justify-center">
          <I.MoreHorizontal size={13} />
        </button>
      </div>

      {/* Nội dung thật — overflow-hidden giữ 1 dòng */}
      <div className={cn("flex items-center gap-1 px-2 overflow-hidden h-full", justify)}>
        {visibleItems.map((item) => (
          <ActionWidget
            key={item.id}
            config={item}
            pageState={pageState}
            inline
            compact={compact}
          />
        ))}
        {hiddenItems.length > 0 && (
          <button
            ref={moreBtnRef}
            type="button"
            onClick={toggleMore}
            className={cn(
              "ml-auto shrink-0 h-6 w-6 rounded border border-border/60 text-muted hover:bg-hover flex items-center justify-center",
              moreOpen && "bg-hover border-accent/40 text-accent",
            )}
            title={`${hiddenItems.length} hành động khác`}
          >
            <I.MoreHorizontal size={13} />
          </button>
        )}
      </div>

      {/* Popover qua portal → không bị clip bởi overflow-hidden của ancestors */}
      {moreOpen &&
        hiddenItems.length > 0 &&
        popoverStyle &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: popoverStyle.top,
              right: popoverStyle.right,
              zIndex: 9999,
            }}
            className="bg-panel border border-border rounded-lg shadow-lg p-1 flex flex-col gap-0.5 min-w-[140px]"
          >
            {hiddenItems.map((item) => (
              <ActionWidget key={item.id} config={item} pageState={pageState} menuItem />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function EmbeddedActionStrip({
  items,
  pageState,
}: {
  items: ActionBarItem[];
  pageState: ReturnType<typeof usePageState>;
}) {
  return (
    <ActionOverflowBar
      items={items}
      compact
      pageState={pageState}
      wrapClass="border-b border-border/40 bg-panel-2/30 shrink-0 h-8"
    />
  );
}

/** Bọc widget có embeddedActions trong flex-col với strip hành động ở trên. */
function withEmbeddedActions(
  content: ReactElement,
  items: ActionBarItem[],
  pageState: ReturnType<typeof usePageState>,
): ReactElement {
  if (items.length === 0) return content;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <EmbeddedActionStrip items={items} pageState={pageState} />
      <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
    </div>
  );
}

/** Thanh nhiều nút hành động nằm ngang. */
function ActionBarWidget({
  cfg,
  pageState,
}: {
  cfg: Record<string, unknown>;
  pageState: ReturnType<typeof usePageState>;
}) {
  const t = useT();
  const items = (cfg.items ?? []) as ActionBarItem[];
  const align = cfg.align as string | undefined;
  const compact = cfg.compact === true;
  const justify =
    align === "right" ? "justify-end" : align === "between" ? "justify-between" : "justify-start";

  if (items.length === 0) {
    return (
      <div className="h-full flex items-center px-2.5">
        <span className="text-xs text-muted/50 italic">{t("widget.no_actions")}</span>
      </div>
    );
  }

  return (
    <ActionOverflowBar
      items={items}
      compact={compact}
      justify={justify}
      pageState={pageState}
      wrapClass="h-full"
    />
  );
}

/** Render một widget theo kind. */
function Widget({ comp, pageId }: { comp: PageComponent; pageId: string }) {
  const cfg = comp.config ?? {};
  const stateKey = `${pageId}:${comp.id}`;
  const pageState = usePageState();
  if (comp.kind === "action") {
    return <ActionWidget config={cfg as unknown as ActionConfig} pageState={pageState} />;
  }
  if (comp.kind === "actionbar") {
    return <ActionBarWidget cfg={cfg} pageState={pageState} />;
  }
  if (comp.kind === "kpi") return <KpiWidget cfg={cfg} />;
  if (comp.kind === "chart") return <ChartWidget cfg={cfg} />;
  if (comp.kind === "list") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return withEmbeddedActions(
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />,
        embActs,
        pageState,
      );
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
        filters={cfg.filters as FilterNode | null | undefined}
        searchFromState={cfg.searchFromState as string | undefined}
        searchStateKey={cfg.searchStateKey as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
        emptyStateShowsAll={
          // Mặc định true khi filterFromState có cấu hình: combobox "tất cả" → hiện hết.
          // Explicit false = master-detail (ẩn khi chưa chọn).
          cfg.emptyStateShowsAll !== false && !!cfg.filterFromState
        }
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
        // Có createForm → nút embeddedActions (vd Nạp lại) render CÙNG hàng với
        // nút "Thêm mới" trong header ListWidget; khi đó strip trên để rỗng.
        embeddedActions={cfg.createForm ? embActs : undefined}
        embeddedFilters={
          cfg.createForm ? (cfg.embeddedFilters as EmbeddedFilter[] | undefined) : undefined
        }
        refetchOnSave={cfg.refetchOnSave === true}
        valueLabels={cfg.valueLabels as Record<string, Record<string, string>> | undefined}
      />,
      cfg.createForm ? [] : embActs,
      pageState,
    );
  }
  if (comp.kind === "form") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<FormWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "detail") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<DetailWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "kanban") return <KanbanWidget cfg={cfg} />;
  if (comp.kind === "step") return <StepWidget cfg={cfg} />;
  if (comp.kind === "split") return <SplitWidget comp={comp} />;
  if (comp.kind === "grid") return <GridWidget comp={comp} />;
  if (comp.kind === "search") return <SearchWidget cfg={cfg} />;
  if (comp.kind === "filter") return <FilterWidget cfg={cfg} />;
  if (comp.kind === "combobox") return <ComboboxWidget cfg={cfg} />;
  if (comp.kind === "listbox") return <ListboxWidget cfg={cfg} />;
  if (comp.kind === "tagbox") return <TagboxWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "document") return <DocumentWidget cfg={cfg} />;
  if (comp.kind === "html") {
    // sandbox="allow-scripts" không có allow-same-origin: frame bị coi
    // là cross-origin nên script bên trong không thể truy cập cookie/
    // localStorage/DOM của app cha — ngăn XSS exfil token.
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={(cfg.html as string) ?? ""}
        className="w-full border-0 block"
        title="HTML widget"
        style={{ minHeight: "120px", height: "100%" }}
      />
    );
  }
  return (
    <div className="p-3 text-xs text-muted h-full flex items-center justify-center text-center">
      Widget "{comp.kind}" — chưa hỗ trợ ở chế độ người dùng.
    </div>
  );
}

const ROW_H = 76;
const GAP = 12; // gap-3

/* ── Helpers lưu/đọc bố cục cá nhân ──────────────────────────
   Logged-in  : key = erp_layout_{userId}_{pageId}
   Anonymous  : key = erp_layout_{pageId}
   ─────────────────────────────────────────────────────────── */
/** Quy tắc ẩn/hiện widget theo 1 state key (vd selKetcau). Đặt ở cfg.visibleWhen. */
function evalVisible(rule: VisibleRule, pageState: ReturnType<typeof usePageState>): boolean {
  const raw = pageState.get(rule.stateKey);
  const sv = raw == null ? "" : String(raw);
  const arr = Array.isArray(rule.value) ? rule.value.map(String) : [];
  switch (rule.op) {
    case "eq":
      return sv === String(rule.value ?? "");
    case "neq":
      return sv !== String(rule.value ?? "");
    case "in":
      return arr.includes(sv);
    case "nin":
      return !arr.includes(sv);
    case "set":
      return sv !== "";
    case "notset":
      return sv === "";
    default:
      return true;
  }
}
/** Bọc 1 widget: ẩn hẳn (không render ô) khi visibleWhen không thỏa. Chế độ sửa
 *  bố cục (editing) luôn hiện để còn sắp xếp được. */
function VisibilityGate({
  rule,
  editing,
  children,
}: {
  rule?: VisibleRule;
  editing: boolean;
  children: React.ReactNode;
}) {
  const pageState = usePageState();
  if (editing || !rule) return <>{children}</>;
  return evalVisible(rule, pageState) ? children : null;
}

export function ConsumerPage({
  pageId,
  chromeless = false,
  active = false,
}: {
  pageId: string;
  /** Portal: bỏ thanh tiêu đề trong trang; đẩy nút điều khiển bố cục lên header
   *  portal (slot #portal-page-actions) qua createPortal. */
  chromeless?: boolean;
  /** Trang đang xem (chỉ trang active mới đẩy nút lên slot — tránh chồng nút). */
  active?: boolean;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const content = useUserObjects((s) => s.pageContent[pageId]);
  const userId = useAuth((s) => s.user?.id ?? null);

  // Slot header portal cho nút điều khiển bố cục khi chromeless.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (chromeless) setActionSlot(document.getElementById("portal-page-actions"));
  }, [chromeless]);

  // Hỗ trợ 2 định dạng content: mảng cũ (PageComponent[]) hoặc mới { meta, components }.
  type RawContent =
    | PageComponent[]
    | { meta?: Record<string, unknown>; components?: PageComponent[] };
  const rawContent = content as RawContent;
  const baseComponents: PageComponent[] = Array.isArray(rawContent)
    ? (rawContent as PageComponent[])
    : ((rawContent as { components?: PageComponent[] }).components ?? []);
  const pageMeta: Record<string, unknown> = Array.isArray(rawContent)
    ? {}
    : ((rawContent as { meta?: Record<string, unknown> }).meta ?? {});
  const screenFit = !!pageMeta.screenFit;

  /* ── Bố cục cá nhân (per-user, localStorage) ──────────── */
  const storageKey = layoutStorageKey(pageId, userId);
  const [personalLayout, setPersonalLayout] = useState<PageComponent[] | null>(null);

  // Nạp khi userId / pageId thay đổi (auth xong mới biết userId)
  useEffect(() => {
    setPersonalLayout(loadPersonalLayout<PageComponent>(storageKey));
  }, [storageKey]);

  const saveLayout = useCallback(
    (comps: PageComponent[]) => {
      savePersonalLayoutLS(storageKey, comps);
      setPersonalLayout(comps);
    },
    [storageKey],
  );
  const resetLayout = useCallback(() => {
    clearPersonalLayoutLS(storageKey);
    setPersonalLayout(null);
  }, [storageKey]);

  /* ── Layout editing state ─────────────────────────────── */
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [localComps, setLocalComps] = useState<PageComponent[]>([]);

  // Nguồn hiển thị: bố cục cá nhân → bố cục gốc
  const displayComps = layoutEditing ? localComps : (personalLayout ?? baseComponents);
  const hasPersonal = personalLayout !== null;
  // Mobile: stack 1 cột theo thứ tự đọc (trên→dưới, trái→phải).
  const renderComps = isMobile
    ? [...displayComps].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    : displayComps;

  /* ── Drag state ───────────────────────────────────────── */
  const [dragCompId, setDragCompId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number } | null>(null);

  /* ── Resize state ─────────────────────────────────────── */
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // Tự KHÍT viewport: widget cuộn được (list/chart/…) ở ĐÁY trang được giãn
  // số hàng (span) để lấp hết chiều cao còn lại của khung main → trang KHÔNG
  // cuộn ngoài, chỉ cuộn trong widget đó. Chỉ desktop + không sửa layout.
  const fillId = useMemo(() => {
    // screenFit: toàn bộ lưới co giãn theo viewport → không cần fillId riêng.
    if (isMobile || layoutEditing || screenFit) return null;
    const FILL = new Set(["list", "chart", "kanban", "pivot", "table"]);

    // Ưu tiên: widget có config.fillHeight === true (opt-in tường minh).
    const explicit = renderComps.filter((c) => c.config?.fillHeight === true && FILL.has(c.kind));
    if (explicit.length === 1) return explicit[0]?.id ?? null;
    // Nhiều widget opt-in → dùng screenFit thay vì fillId; không tự chọn 1.
    if (explicit.length > 1) return null;

    // Fallback: auto-detect widget cuộn được ở đáy (hành vi cũ).
    let bottom: PageComponent | null = null;
    let bottomEnd = -1;
    let tieCount = 0; // số widget cùng chạm hàng đáy (y+h lớn nhất)
    for (const c of renderComps) {
      const end = (c.y ?? 0) + (c.h ?? 0);
      if (end > bottomEnd) {
        bottomEnd = end;
        bottom = c;
        tieCount = 1;
      } else if (end === bottomEnd) {
        tieCount++;
      }
    }
    // Nhiều widget cùng chạm đáy (vd các cột full-height cạnh nhau: trái/giữa/phải
    // đều y=0,h=20) → KHÔNG có widget "đáy" duy nhất để giãn. Nếu vẫn giãn 1 widget
    // (gridRow "1/-1" + gridTemplateRows 1 hàng 1fr) thì các widget kia span nhiều
    // hàng tạo hàng ngầm 76px → ép hàng 1fr co về ~0 → widget fill bị ẩn. Bỏ fill,
    // để lưới render tự nhiên theo h (mọi cột cao bằng nhau, đều hiển thị).
    if (tieCount > 1) return null;
    return bottom && FILL.has(bottom.kind) ? bottom.id : null;
  }, [renderComps, isMobile, layoutEditing, screenFit]);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    if (!fillId && !screenFit) {
      setAvailH(0);
      return;
    }
    const measure = () => {
      const top = gridRef.current?.getBoundingClientRect().top ?? 0;
      setAvailH(Math.max(0, window.innerHeight - top - 8));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fillId, screenFit]);
  // Hàng (1-based) bắt đầu của widget fill — để dựng gridTemplateRows: các hàng
  // trên cố định ROW_H, hàng widget fill = 1fr → lấp KHÍT phần dư (không làm
  // tròn theo bội số ROW_H như cách giãn span cũ → hết khoảng trống dưới list).
  const fillRowStart = useMemo(() => {
    const fc = renderComps.find((c) => c.id === fillId);
    return fc ? (fc.y ?? 0) + 1 : 0;
  }, [renderComps, fillId]);
  const resizeRef = useRef<{
    compId: string;
    dir: "e" | "s" | "se";
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
    compX: number;
  } | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);

  /* ── Auto-scroll ──────────────────────────────────────── */
  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);
  const startAutoScroll = useCallback(
    (speed: number) => {
      stopAutoScroll();
      const tick = () => {
        canvasRef.current?.scrollBy({ top: speed });
        scrollRafRef.current = requestAnimationFrame(tick);
      };
      scrollRafRef.current = requestAnimationFrame(tick);
    },
    [stopAutoScroll],
  );
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  /* ── Window mouse events (resize) ─────────────────────── */
  useEffect(() => {
    if (!layoutEditing) return;
    const ROW_STRIDE = ROW_H + GAP;
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const grid = gridRef.current;
      if (!grid) return;
      const colW = (grid.offsetWidth - 11 * GAP) / 12;
      const dx = e.clientX - r.startMouseX;
      const dy = e.clientY - r.startMouseY;
      let newW = r.startW;
      let newH = r.startH;
      if (r.dir === "e" || r.dir === "se")
        newW = Math.max(1, Math.min(12 - r.compX, Math.round(r.startW + dx / colW)));
      if (r.dir === "s" || r.dir === "se")
        newH = Math.max(1, Math.round(r.startH + dy / ROW_STRIDE));
      setLocalComps((cs) => cs.map((c) => (c.id === r.compId ? { ...c, w: newW, h: newH } : c)));
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      const id = resizeRef.current.compId;
      resizeRef.current = null;
      setResizingId(null);
      setLocalComps((cs) => {
        const resolved = applyInsertAndResolve(id, cs);
        saveLayout(resolved); // lưu bố cục cá nhân
        return resolved;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layoutEditing, saveLayout]);

  /* ── Grid coordinate helper ───────────────────────────── */
  const computeDropPos = (mouseX: number, mouseY: number) => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(11, Math.floor(((mouseX - rect.left) / rect.width) * 12)));
    const y = Math.max(0, Math.floor((mouseY - rect.top) / (ROW_H + GAP)));
    return { x, y };
  };

  /* ── Canvas drag handlers ─────────────────────────────── */
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!dragCompId) return;
    e.preventDefault();
    setDropPos(computeDropPos(e.clientX, e.clientY));
    const el = canvasRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const ZONE = 64;
      const dy = e.clientY - rect.top;
      const db = rect.bottom - e.clientY;
      if (dy < ZONE) startAutoScroll(-Math.ceil((1 - dy / ZONE) * 14));
      else if (db < ZONE) startAutoScroll(Math.ceil((1 - db / ZONE) * 14));
      else stopAutoScroll();
    }
  };
  const onCanvasDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropPos(null);
      stopAutoScroll();
    }
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    const raw = dropPos ?? computeDropPos(e.clientX, e.clientY);
    if (dragCompId && raw) {
      const comp = localComps.find((c) => c.id === dragCompId);
      if (comp) {
        const nx = Math.max(0, Math.min(12 - comp.w, raw.x));
        const ny = Math.max(0, raw.y);
        const updated = applyInsertAndResolve(
          dragCompId,
          localComps.map((c) => (c.id === dragCompId ? { ...c, x: nx, y: ny } : c)),
        );
        setLocalComps(updated);
        saveLayout(updated); // lưu bố cục cá nhân
      }
    }
    setDragCompId(null);
    setDropPos(null);
  };

  /* ── Enter / exit / reset ─────────────────────────────── */
  const enterEdit = () => {
    // bắt đầu từ bố cục cá nhân đang hiện (hoặc bố cục gốc)
    setLocalComps(personalLayout ?? baseComponents);
    setLayoutEditing(true);
  };
  const exitEdit = () => {
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };
  const handleReset = () => {
    resetLayout();
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };

  // Nút điều khiển bố cục (Mặc định / Sắp xếp / Xong) — chỉ dùng cho header portal (chromeless).
  const headerControls = (
    <>
      {/* Nút trở về mặc định — hiện khi có bố cục cá nhân */}
      {hasPersonal && !layoutEditing && !isMobile && (
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-danger/10 hover:border-danger/40 hover:text-danger text-muted transition-colors"
          title="Xoá bố cục cá nhân, trở về bố cục mặc định của trang"
        >
          <I.Undo size={13} />
          Mặc định
        </button>
      )}

      {/* Nút Sắp xếp / Xong — ẩn trên mobile (kéo-thả không khả dụng) */}
      {isMobile ? null : layoutEditing ? (
        <button
          type="button"
          onClick={exitEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent/90 font-medium"
        >
          <I.Check size={13} />
          Xong
        </button>
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-hover text-muted"
        >
          <I.Grip size={13} />
          Sắp xếp
        </button>
      )}
    </>
  );

  return (
    <PageStateProvider>
      <div ref={canvasRef} className="overflow-y-auto overflow-x-hidden h-full">
        {/* Nội dung trang full width (bỏ giới hạn max-w để tràn 100%).
            px trái/phải = 1px để thành phần sát mép; giữ py trên/dưới. */}
        <div className="py-0.5 px-px">
          {/* Chromeless (portal): CHỈ trang đang xem đẩy nút lên header portal. */}
          {chromeless &&
            active &&
            actionSlot &&
            createPortal(
              <div className="flex items-center gap-1.5">{headerControls}</div>,
              actionSlot,
            )}

          {displayComps.length === 0 ? (
            <div className="card p-12 text-center text-muted text-sm">{t("widget.empty_page")}</div>
          ) : (
            <div
              onDragOver={layoutEditing ? onCanvasDragOver : undefined}
              onDragLeave={layoutEditing ? onCanvasDragLeave : undefined}
              onDrop={layoutEditing ? onCanvasDrop : undefined}
            >
              <div
                ref={gridRef}
                className="grid gap-1"
                style={{
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(12, 1fr)",
                  // screenFit → mỗi hàng 1fr (chia tỷ lệ theo h);
                  // mặc định: ROW_H px cố định (mobile = auto-fit nội dung).
                  gridAutoRows: isMobile
                    ? "auto"
                    : !layoutEditing && screenFit && availH > 0
                      ? "1fr"
                      : `${ROW_H}px`,
                  // screenFit: ghim chiều cao = availH để fr hoạt động.
                  ...(!isMobile && !layoutEditing && screenFit && availH > 0
                    ? {
                        height: availH,
                        // meta.gridTemplateRows cho phép override từng hàng (vd "48px minmax(0,1fr)")
                        ...(pageMeta.gridTemplateRows
                          ? { gridTemplateRows: pageMeta.gridTemplateRows as string }
                          : {}),
                      }
                    : // fillId: 1 widget đáy lấp hết chiều cao còn lại (hành vi cũ).
                      !isMobile && fillId && availH > 0 && fillRowStart > 0
                      ? {
                          height: availH,
                          // fillRowStart===1 → repeat(0,…) CSS không hợp lệ → chỉ
                          // phát repeat khi có hàng trên widget fill.
                          gridTemplateRows:
                            fillRowStart > 1
                              ? `repeat(${fillRowStart - 1}, auto) minmax(0, 1fr)`
                              : "minmax(0, 1fr)",
                        }
                      : {}),
                }}
              >
                {/* Ghost placeholder during drag */}
                {layoutEditing &&
                  dragCompId &&
                  dropPos &&
                  (() => {
                    const dc = localComps.find((c) => c.id === dragCompId);
                    if (!dc) return null;
                    const gx = Math.max(0, Math.min(12 - dc.w, dropPos.x));
                    const gy = Math.max(0, dropPos.y);
                    return (
                      <div
                        className="pointer-events-none rounded-md border-2 border-dashed border-accent bg-accent/10 z-10"
                        style={{
                          gridColumn: `${gx + 1} / span ${dc.w}`,
                          gridRow: `${gy + 1} / span ${dc.h}`,
                        }}
                      />
                    );
                  })()}

                {renderComps.map((c) => {
                  const colStart = (c.x ?? 0) + 1;
                  const rowStart = (c.y ?? 0) + 1;
                  const w = Math.min(c.w || 3, 12);
                  // Widget fill (đáy, cuộn được): giãn span để lấp hết viewport.
                  let h = c.h || 2;
                  if (c.id === fillId && availH > 0) {
                    const GAP = 4; // gap-1 giữa các hàng
                    const availForFill = availH - (rowStart - 1) * (ROW_H + GAP);
                    h = Math.max(2, Math.floor((availForFill + GAP) / (ROW_H + GAP)));
                  }
                  const isBeingDragged = dragCompId === c.id;
                  const isBeingResized = resizingId === c.id;
                  return (
                    <VisibilityGate
                      key={c.id}
                      rule={(c.config as { visibleWhen?: VisibleRule } | undefined)?.visibleWhen}
                      editing={layoutEditing}
                    >
                      <div
                        draggable={layoutEditing && !isBeingResized && !isMobile}
                        className={cn(
                          "card overflow-hidden",
                          layoutEditing && !isMobile && "relative group/card",
                          layoutEditing &&
                            !isBeingResized &&
                            !isMobile &&
                            "cursor-grab active:cursor-grabbing",
                          isBeingDragged && "opacity-40",
                          isBeingResized && "select-none",
                        )}
                        style={
                          isMobile
                            ? { minHeight: h * ROW_H }
                            : {
                                gridColumn: `${colStart} / span ${w}`,
                                // Widget fill: span tới HÀNG CUỐI (1fr) để lấp khít;
                                // còn lại span theo số hàng h.
                                gridRow:
                                  c.id === fillId && availH > 0
                                    ? `${rowStart} / -1`
                                    : `${rowStart} / span ${h}`,
                              }
                        }
                        onDragStart={
                          layoutEditing
                            ? (e) => {
                                if (isBeingResized) {
                                  e.preventDefault();
                                  return;
                                }
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", c.id);
                                setDragCompId(c.id);
                                setDropPos(null);
                              }
                            : undefined
                        }
                        onDragEnd={
                          layoutEditing
                            ? () => {
                                setDragCompId(null);
                                setDropPos(null);
                                stopAutoScroll();
                              }
                            : undefined
                        }
                      >
                        {isMobile || !isScalableKind(c.kind) ? (
                          // Danh sách/tương tác: giữ nguyên + tự cuộn; mobile: layout dọc.
                          <Widget comp={c} pageId={pageId} />
                        ) : (
                          <ScaleToFit>
                            <Widget comp={c} pageId={pageId} />
                          </ScaleToFit>
                        )}

                        {/* Resize handles — chỉ hiện khi layoutEditing */}
                        {layoutEditing && (
                          <>
                            <div
                              className="absolute right-0 top-0 bottom-2.5 w-1.5 cursor-ew-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "e",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            />
                            <div
                              className="absolute left-0 right-2.5 bottom-0 h-1.5 cursor-ns-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "s",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            />
                            <div
                              className="absolute right-0 bottom-0 w-2.5 h-2.5 cursor-nwse-resize z-30 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors flex items-center justify-center"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "se",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            >
                              <svg
                                width="7"
                                height="7"
                                viewBox="0 0 7 7"
                                className="text-accent/70"
                                aria-hidden="true"
                              >
                                <path
                                  d="M1 6 L6 1 M3.5 6 L6 3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </div>
                          </>
                        )}
                      </div>
                    </VisibilityGate>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageStateProvider>
  );
}
