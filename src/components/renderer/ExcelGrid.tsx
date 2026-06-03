/* ==========================================================
   ExcelGrid — bảng tính nâng cao kiểu Excel.
   Tính năng: chọn vùng, gợi ý hàm, sắp xếp nhiều cột,
   lọc theo cột, kéo đổi thứ tự cột, công thức ~60 hàm.
   ========================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { applyFieldFormat } from "@/lib/format";
import { colToLetter, evalFormula, type Value } from "@/lib/formula-eval";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";

const COL_W = 110;
const ROW_H = 24;
const ROW_NUM_W = 42;

const NUMERIC_TYPES = new Set(["number", "integer", "currency", "formula"]);
const BOOL_TYPES = new Set(["bool", "boolean"]);

const FORMULA_FNS = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "PRODUCT",
  "SUMPRODUCT",
  "SUMIF",
  "COUNTIF",
  "AVERAGEIF",
  "MAXIFS",
  "MINIFS",
  "ABS",
  "INT",
  "TRUNC",
  "SIGN",
  "MOD",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "CEILING",
  "FLOOR",
  "POWER",
  "SQRT",
  "EXP",
  "LN",
  "LOG",
  "LOG10",
  "PI",
  "RAND",
  "RANDBETWEEN",
  "EVEN",
  "ODD",
  "GCD",
  "LCM",
  "N",
  "IF",
  "IFS",
  "AND",
  "OR",
  "NOT",
  "XOR",
  "IFERROR",
  "IFNA",
  "SWITCH",
  "CONCAT",
  "CONCATENATE",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "UPPER",
  "LOWER",
  "PROPER",
  "TRIM",
  "SUBSTITUTE",
  "REPLACE",
  "REPT",
  "TEXT",
  "VALUE",
  "FIND",
  "SEARCH",
  "EXACT",
  "CHAR",
  "CODE",
  "CLEAN",
  "NUMBERVALUE",
  "VLOOKUP",
  "HLOOKUP",
  "INDEX",
  "MATCH",
  "CHOOSE",
  "TODAY",
  "NOW",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "DATE",
  "DATEDIF",
  "EDATE",
  "EOMONTH",
  "WEEKDAY",
  "WEEKNUM",
  "ISBLANK",
  "ISNUMBER",
  "ISTEXT",
  "ISERROR",
  "ISNA",
  "NA",
  "ROWS",
  "COLUMNS",
  "ROW",
  "COLUMN",
  "STDEV",
  "STDEVP",
  "MEDIAN",
  "LARGE",
  "SMALL",
  "RANK",
  "PERCENTILE",
] as const;

interface ExcelGridProps {
  fields: EntityField[];
  rows: Record<string, unknown>[];
  batchEdit?: boolean;
  onSave?: (rowId: unknown, changes: Record<string, unknown>) => Promise<void>;
  onRowClick?: (row: Record<string, unknown>) => void;
  isRowSelected?: (row: Record<string, unknown>) => boolean;
}

type SortKey = { col: number; dir: "asc" | "desc" }; // col = original field index
type Pos = { r: number; c: number };
type Range = { r1: number; c1: number; r2: number; c2: number };

function displayVal(v: Value): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return String(v);
    return v.toPrecision(10).replace(/\.?0+$/, "");
  }
  return String(v);
}
function isErr(v: string) {
  return v.startsWith("#") && (v.endsWith("!") || v.endsWith("?"));
}

export function ExcelGrid({
  fields,
  rows,
  batchEdit = false,
  onSave,
  onRowClick,
  isRowSelected,
}: ExcelGridProps) {
  const t = useT();
  const NROWS = rows.length;

  /* ── Cell data [origRow][origCol] ────────────────────────── */
  const [cellData, setCellData] = useState<string[][]>(() =>
    rows.map((row) =>
      fields.map((f) => {
        const v = row[f.name];
        return v == null ? "" : String(v);
      }),
    ),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on rows identity change
  useEffect(() => {
    setCellData(
      rows.map((row) =>
        fields.map((f) => {
          const v = row[f.name];
          return v == null ? "" : String(v);
        }),
      ),
    );
    setPending(new Map());
  }, [rows]);

  /* ── Column order: dispC → origC ─────────────────────────── */
  const [colOrder, setColOrder] = useState<number[]>(() => fields.map((_, i) => i));
  const [dragColSrc, setDragColSrc] = useState<number | null>(null);
  const [dragColOver, setDragColOver] = useState<number | null>(null);
  const colDragging = useRef(false);
  const DCOLS = colOrder.length;

  /* ── Column widths (key = origC, px) ─────────────────────── */
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  const resizingRef = useRef<{ origC: number; startX: number; startW: number } | null>(null);
  const getColWidth = (origC: number) => colWidths[origC] ?? COL_W;

  /* ── Sort keys (use origC) ───────────────────────────────── */
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  /* ── Column filters (key = origC) ────────────────────────── */
  const [colFilters, setColFilters] = useState<Record<number, string>>({});
  const [filterMenuCol, setFilterMenuCol] = useState<number | null>(null); // dispC
  const filterRef = useRef<HTMLInputElement>(null);

  /* ── Resize listeners (global, mount-once) ───────────────── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const newW = Math.max(50, r.startW + e.clientX - r.startX);
      setColWidths((prev) => ({ ...prev, [r.origC]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  /* ── Auto-fit tất cả cột theo nội dung (canvas measureText) ─ */
  const autoFitAllCols = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const measure = (text: string, font: string) => {
      if (!ctx) return text.length * 7;
      // tach phep gan khoi bieu thuc: set font roi do chu (giu nguyen logic)
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    const HDR = "600 10px ui-sans-serif,system-ui,sans-serif";
    const CELL = "12px ui-sans-serif,system-ui,sans-serif";
    const next: Record<number, number> = {};
    for (let dc = 0; dc < DCOLS; dc++) {
      const oc = colOrder[dc]!;
      const f = fields[oc];
      let w = f ? measure(f.label, HDR) + 58 : 80; // 58 = drag+letter+icons padding
      for (let dr = 0; dr < VISIBLE; dr++) {
        const cw = measure(getDisplay(dr, dc), CELL) + 18;
        if (cw > w) w = cw;
      }
      next[oc] = Math.max(60, Math.min(420, w));
    }
    setColWidths(next);
  };

  /* ── Visible rows after filter + sort ───────────────────── */
  const visibleRows = useMemo(() => {
    let idxs = Array.from({ length: NROWS }, (_, i) => i);
    for (const [k, fv] of Object.entries(colFilters)) {
      if (!fv.trim()) continue;
      const origC = Number(k);
      const term = fv.toLowerCase();
      idxs = idxs.filter((rr) => (cellData[rr]?.[origC] ?? "").toLowerCase().includes(term));
    }
    if (sortKeys.length > 0) {
      idxs.sort((a, b) => {
        for (const { col, dir } of sortKeys) {
          const av = cellData[a]?.[col] ?? "",
            bv = cellData[b]?.[col] ?? "";
          const an = Number(av),
            bn = Number(bv);
          const cmp =
            Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== ""
              ? an - bn
              : String(av).localeCompare(String(bv), "vi");
          if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return idxs;
  }, [cellData, colFilters, sortKeys, NROWS]);
  const VISIBLE = visibleRows.length;

  /* ── Selection: anchor (sel) + range end (selEnd) ──────── */
  const [sel, setSel] = useState<Pos | null>(null);
  const [selEnd, setSelEnd] = useState<Pos | null>(null);
  const selRef = useRef<Pos | null>(null);
  selRef.current = sel;
  const selEndRef = useRef<Pos | null>(null);
  selEndRef.current = selEnd;
  const mouseSelecting = useRef(false);

  const selRange = useMemo<Range | null>(() => {
    if (!sel) return null;
    const e = selEnd ?? sel;
    return {
      r1: Math.min(sel.r, e.r),
      c1: Math.min(sel.c, e.c),
      r2: Math.max(sel.r, e.r),
      c2: Math.max(sel.c, e.c),
    };
  }, [sel, selEnd]);

  const inRange = (r: number, c: number) =>
    !!selRange && r >= selRange.r1 && r <= selRange.r2 && c >= selRange.c1 && c <= selRange.c2;
  const isMulti = !!selRange && (selRange.r1 !== selRange.r2 || selRange.c1 !== selRange.c2);

  /* ── Edit state ───────────────────────────────────────────── */
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");

  /* ── Formula autocomplete ─────────────────────────────────── */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggIdx, setSuggIdx] = useState(0);
  useEffect(() => {
    if (!editing || !editVal.startsWith("=")) {
      setSuggestions([]);
      return;
    }
    const m = editVal.match(/([A-Z][A-Z0-9]*)$/i);
    if (!m) {
      setSuggestions([]);
      return;
    }
    const pfx = m[1]!.toUpperCase();
    setSuggestions(FORMULA_FNS.filter((fn) => fn.startsWith(pfx) && fn !== pfx).slice(0, 8));
    setSuggIdx(0);
  }, [editing, editVal]);

  /* ── Pending edits ────────────────────────────────────────── */
  const [pending, setPending] = useState<Map<number, Record<string, string>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  /* ── Cell data access (display coords) ───────────────────── */
  const getCellRaw = useCallback(
    (dr: number, dc: number): string => {
      const rr = visibleRows[dr],
        rc = colOrder[dc];
      if (rr == null || rc == null) return "";
      return cellData[rr]?.[rc] ?? "";
    },
    [cellData, visibleRows, colOrder],
  );

  const getCellValue = useCallback(
    (dr: number, dc: number, depth = 0): Value => {
      if (dr < 0 || dr >= VISIBLE || dc < 0 || dc >= DCOLS) return "";
      const raw = getCellRaw(dr, dc);
      if (raw.startsWith("=")) return evalFormula(raw.slice(1), getCellValue, depth);
      const n = Number(raw);
      return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
    },
    [getCellRaw, VISIBLE, DCOLS],
  );

  const getDisplay = (dr: number, dc: number): string => {
    const raw = getCellRaw(dr, dc);
    if (raw === "") return "";
    if (raw.startsWith("=")) return displayVal(getCellValue(dr, dc));
    const origC = colOrder[dc];
    const field = origC != null ? fields[origC] : undefined;
    if (!field) return raw;
    const formatted = applyFieldFormat(field, raw);
    return formatted === "—" ? "" : formatted;
  };

  /* ── Set cell (display → original coords) ────────────────── */
  const setCell = (dr: number, dc: number, val: string) => {
    const rr = visibleRows[dr],
      rc = colOrder[dc];
    if (rr == null || rc == null) return;
    setCellData((prev) => {
      const next = prev.map((r) => [...r]);
      if (!next[rr]) return prev;
      next[rr]![rc] = val;
      return next;
    });
    const fn = fields[rc]?.name;
    if (!fn) return;
    setPending((prev) => {
      const next = new Map(prev);
      const row = { ...(next.get(rr) ?? {}) };
      row[fn] = val;
      next.set(rr, row);
      return next;
    });
  };

  /* ── Edit ─────────────────────────────────────────────────── */
  const startEdit = (r: number, c: number) => {
    setSel({ r, c });
    setSelEnd(null);
    setEditVal(getCellRaw(r, c));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: setCell on dinh xuyen render, them vao deps lam invalidate callback khong can thiet
  const commitEdit = useCallback(
    (save = true) => {
      if (!selRef.current || !editing) return;
      const { r, c } = selRef.current;
      if (save) setCell(r, c, editVal);
      setEditing(false);
      setSuggestions([]);
    },
    [editing, editVal],
  );

  /* ── Save ─────────────────────────────────────────────────── */
  const saveRow = useCallback(
    async (dr: number) => {
      const rr = visibleRows[dr];
      if (rr == null) return;
      const rowId = rows[rr]?.id;
      if (rowId == null || !onSave) return;
      const changes = pending.get(rr);
      if (!changes) return;
      const resolved: Record<string, unknown> = {};
      for (const [fn, raw] of Object.entries(changes)) {
        const origC = fields.findIndex((f) => f.name === fn);
        const dc2 = colOrder.indexOf(origC);
        resolved[fn] =
          origC >= 0 && raw.startsWith("=")
            ? displayVal(getCellValue(dr, dc2 >= 0 ? dc2 : origC))
            : raw;
      }
      await onSave(rowId, resolved);
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(rr);
        return next;
      });
    },
    [visibleRows, rows, pending, fields, colOrder, getCellValue, onSave],
  );

  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      for (let dr = 0; dr < VISIBLE; dr++) {
        const rr = visibleRows[dr];
        if (rr != null && pending.has(rr)) await saveRow(dr);
      }
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Movement ─────────────────────────────────────────────── */
  const move = (dr: number, dc: number, extend = false) => {
    if (extend) {
      const base = selEndRef.current ?? selRef.current;
      if (!base) return;
      setSelEnd({
        r: Math.max(0, Math.min(VISIBLE - 1, base.r + dr)),
        c: Math.max(0, Math.min(DCOLS - 1, base.c + dc)),
      });
    } else {
      const cur = selRef.current;
      setSel(
        cur
          ? {
              r: Math.max(0, Math.min(VISIBLE - 1, cur.r + dr)),
              c: Math.max(0, Math.min(DCOLS - 1, cur.c + dc)),
            }
          : { r: 0, c: 0 },
      );
      setSelEnd(null);
    }
  };

  /* ── Keyboard ─────────────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (filterMenuCol !== null) return;
    if (editing) return;
    const s = selRef.current;
    const sh = e.shiftKey;
    if (!s) {
      if (e.key !== "Tab") setSel({ r: 0, c: 0 });
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        move(-1, 0, sh);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(1, 0, sh);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(0, -1, sh);
        break;
      case "ArrowRight":
        e.preventDefault();
        move(0, 1, sh);
        break;
      case "Tab":
        e.preventDefault();
        move(0, sh ? -1 : 1);
        break;
      case "Enter":
        e.preventDefault();
        sh ? move(-1, 0) : startEdit(s.r, s.c);
        break;
      case "F2":
        e.preventDefault();
        startEdit(s.r, s.c);
        break;
      case "Delete":
      case "Backspace": {
        const sr = selRange;
        if (sr)
          for (let r = sr.r1; r <= sr.r2; r++)
            for (let c = sr.c1; c <= sr.c2; c++) setCell(r, c, "");
        else setCell(s.r, s.c, "");
        break;
      }
      case "Escape":
        setSel(null);
        setSelEnd(null);
        break;
      default:
        if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setSel({ r: 0, c: 0 });
          setSelEnd({ r: VISIBLE - 1, c: DCOLS - 1 });
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setEditVal(e.key);
          setEditing(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
    }
  };

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggIdx((i) => Math.min(suggestions.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        const fn = suggestions[suggIdx];
        if (fn) {
          e.preventDefault();
          setEditVal(editVal.replace(/([A-Z][A-Z0-9]*)$/i, fn + "("));
          setSuggestions([]);
          return;
        }
      }
    }
    if (e.key === "Escape") {
      commitEdit(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(true);
      if (!batchEdit && selRef.current) void saveRow(selRef.current.r);
      move(1, 0);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(true);
      if (!batchEdit && selRef.current) void saveRow(selRef.current.r);
      move(0, e.shiftKey ? -1 : 1);
    }
  };

  /* ── Auto-scroll selection into view ─────────────────────── */
  useEffect(() => {
    if (!sel) return;
    cellRefs.current
      .get(`${sel.r},${sel.c}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  /* ── Close filter menu on outside click ──────────────────── */
  useEffect(() => {
    if (filterMenuCol === null) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-filterpop]")) setFilterMenuCol(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [filterMenuCol]);

  /* ── Sort: click header ───────────────────────────────────── */
  const handleHeaderClick = (dispC: number, e: React.MouseEvent) => {
    if (colDragging.current) return;
    if ((e.target as Element).closest("[data-resize-handle]")) return;
    const origC = colOrder[dispC];
    if (origC == null) return;
    setSortKeys((prev) => {
      const idx = prev.findIndex((sk) => sk.col === origC);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (idx === -1) return [...prev, { col: origC, dir: "asc" }];
        const next = [...prev];
        if (next[idx]!.dir === "asc") next[idx] = { col: origC, dir: "desc" };
        else next.splice(idx, 1);
        return next;
      }
      if (prev.length === 1 && idx === 0) {
        if (prev[0]!.dir === "asc") return [{ col: origC, dir: "desc" }];
        return [];
      }
      return [{ col: origC, dir: "asc" }];
    });
  };

  /* ── Column drag reorder ──────────────────────────────────── */
  const onColDragStart = (dc: number, e: React.DragEvent) => {
    colDragging.current = true;
    setDragColSrc(dc);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dc));
  };
  const onColDragOver = (dc: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragColOver(dc);
  };
  const onColDrop = (dst: number, e: React.DragEvent) => {
    e.preventDefault();
    const src = dragColSrc;
    if (src != null && src !== dst) {
      setColOrder((prev) => {
        const n = [...prev];
        const [r] = n.splice(src, 1);
        n.splice(dst, 0, r!);
        return n;
      });
    }
    setDragColSrc(null);
    setDragColOver(null);
    setTimeout(() => {
      colDragging.current = false;
    }, 50);
  };
  const onColDragEnd = () => {
    setDragColSrc(null);
    setDragColOver(null);
    setTimeout(() => {
      colDragging.current = false;
    }, 50);
  };

  /* ── Selection stats ─────────────────────────────────────── */
  const selStats = useMemo(() => {
    if (!selRange) return null;
    const vals: Value[] = [];
    for (let r = selRange.r1; r <= selRange.r2; r++)
      for (let c = selRange.c1; c <= selRange.c2; c++) vals.push(getCellValue(r, c));
    const ns = vals.filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
    const nonBlank = vals.filter((v) => v !== "").length;
    if (ns.length === 0) return nonBlank > 0 ? { count: nonBlank } : null;
    const sum = ns.reduce((a, b) => a + b, 0);
    return { count: nonBlank, sum, avg: sum / ns.length, nums: ns.length };
  }, [selRange, getCellValue]);

  const totalPending = pending.size;
  const activeFilters = Object.values(colFilters).filter((v) => v.trim()).length;

  /* ── Formula bar display ──────────────────────────────────── */
  const barAddr = sel
    ? isMulti && selRange
      ? `${colToLetter(selRange.c1)}${selRange.r1 + 1}:${colToLetter(selRange.c2)}${selRange.r2 + 1}`
      : `${colToLetter(sel.c)}${sel.r + 1}`
    : "";
  const barVal = sel ? getCellRaw(sel.r, sel.c) : "";

  /* ── Render ───────────────────────────────────────────────── */
  return (
    // biome-ignore lint/a11y/useSemanticElements: dung div role=grid chu y - layout spreadsheet ao hoa (virtualized) khong dung <table> that
    <div
      ref={containerRef}
      role="grid"
      className="flex flex-col h-full outline-none select-none font-mono text-xs"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseUp={() => {
        mouseSelecting.current = false;
      }}
      aria-label={t("excel.aria_label")}
    >
      {/* ── Formula bar ── */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-panel-2/40 shrink-0">
        <span className="text-[10px] text-muted bg-bg-soft border border-border rounded px-1.5 h-5 flex items-center min-w-[56px] justify-center font-semibold tracking-tight">
          {barAddr}
        </span>
        <span className="text-muted/40 font-serif">ƒx</span>
        <input
          type="text"
          value={editing ? editVal : barVal}
          onChange={(e) => {
            if (editing) setEditVal(e.target.value);
            else if (sel) setCell(sel.r, sel.c, e.target.value);
          }}
          onFocus={() => {
            if (sel && !editing) {
              setEditVal(barVal);
              setEditing(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          className="flex-1 bg-transparent outline-none text-xs font-mono border-b border-transparent focus:border-accent transition-colors"
          placeholder={t("excel.formula_placeholder")}
        />
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => setColFilters({})}
            className="flex items-center gap-1 text-[10px] text-accent border border-accent/30 rounded px-1.5 h-5 hover:bg-accent/10"
            title={t("excel.filter_clear_all_title")}
          >
            <I.Filter size={9} />
            {t("excel.active_filters", { count: activeFilters })}
          </button>
        )}
      </div>

      {/* ── Batch save bar ── */}
      {batchEdit && totalPending > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
          <I.AlertCircle size={12} className="text-warning shrink-0" />
          <span className="text-xs text-warning flex-1">
            {t("excel.pending_rows", { count: totalPending })}
          </span>
          {saveErr && <span className="text-xs text-danger">{saveErr}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={saveAll}
            className="px-2.5 py-0.5 rounded text-xs bg-warning text-white hover:bg-warning/90 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("excel.save_all")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPending(new Map());
              setCellData(
                rows.map((row) =>
                  fields.map((f) => {
                    const v = row[f.name];
                    return v == null ? "" : String(v);
                  }),
                ),
              );
            }}
            className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto">
        <table
          className="border-collapse"
          style={{
            tableLayout: "fixed",
            width: ROW_NUM_W + colOrder.reduce((s, oc) => s + getColWidth(oc), 0),
          }}
        >
          <colgroup>
            <col style={{ width: ROW_NUM_W }} />
            {colOrder.map((oc) => (
              <col key={oc} style={{ width: getColWidth(oc) }} />
            ))}
          </colgroup>

          {/* Header */}
          <thead>
            <tr>
              {/* Corner: select-all */}
              <th
                className="border border-border bg-panel-2 sticky top-0 z-20"
                style={{ height: ROW_H }}
              >
                <button
                  type="button"
                  className="w-full h-full flex items-center justify-center text-[11px] text-muted/60 hover:text-accent hover:bg-accent/10"
                  title={t("excel.select_all_title")}
                  onClick={() => {
                    setSel({ r: 0, c: 0 });
                    setSelEnd({ r: VISIBLE - 1, c: DCOLS - 1 });
                    containerRef.current?.focus();
                  }}
                >
                  ▣
                </button>
              </th>

              {colOrder.map((origC, dispC) => {
                const f = fields[origC]!;
                const sortInfo = sortKeys.find((sk) => sk.col === origC);
                const sortPri = sortKeys.findIndex((sk) => sk.col === origC) + 1;
                const hasFilter = !!colFilters[origC]?.trim();
                const isFilterOpen = filterMenuCol === dispC;
                const isDragSrc = dragColSrc === dispC;
                const isDragOver = dragColOver === dispC;
                const colHighlighted = !!selRange && dispC >= selRange.c1 && dispC <= selRange.c2;

                return (
                  <th
                    key={origC}
                    draggable
                    onDragStart={(e) => {
                      if (resizingRef.current) {
                        e.preventDefault();
                        return;
                      }
                      onColDragStart(dispC, e);
                    }}
                    onDragOver={(e) => onColDragOver(dispC, e)}
                    onDrop={(e) => onColDrop(dispC, e)}
                    onDragEnd={onColDragEnd}
                    onClick={(e) => handleHeaderClick(dispC, e)}
                    className={cn(
                      "border border-border bg-panel-2 text-left cursor-pointer select-none sticky top-0",
                      isFilterOpen ? "z-[60]" : "z-20",
                      colHighlighted && "bg-accent/10",
                      isDragOver && "bg-accent/15 border-accent/60",
                      isDragSrc && "opacity-40",
                    )}
                    style={{ height: ROW_H, overflow: "visible" }}
                    title={`${f.label} — ${t("excel.col_header_hint")}`}
                  >
                    <div className="flex items-center gap-0.5 h-full px-1">
                      {/* drag indicator */}
                      <span className="text-muted/30 cursor-grab text-[8px] shrink-0 select-none">
                        ⠿
                      </span>
                      <span className="text-accent/50 font-normal text-[9px] shrink-0">
                        {colToLetter(dispC)}
                      </span>
                      <span className="font-semibold text-[10px] truncate flex-1 ml-0.5">
                        {f.label}
                      </span>
                      {sortInfo && (
                        <span className="shrink-0 text-accent text-[9px] font-bold flex items-center gap-px">
                          {sortInfo.dir === "asc" ? (
                            <I.ChevronUp size={9} />
                          ) : (
                            <I.ChevronDown size={9} />
                          )}
                          {sortKeys.length > 1 && <span className="text-[8px]">{sortPri}</span>}
                        </span>
                      )}
                      {/* Filter toggle button */}
                      <button
                        type="button"
                        data-filterpop
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterMenuCol(isFilterOpen ? null : dispC);
                          if (!isFilterOpen) setTimeout(() => filterRef.current?.focus(), 50);
                        }}
                        className={cn(
                          "shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded",
                          hasFilter
                            ? "text-accent bg-accent/15"
                            : "text-muted/40 hover:bg-accent/10",
                        )}
                        title={
                          hasFilter ? t("excel.filter_active_title") : t("excel.filter_col_title")
                        }
                      >
                        <I.Filter size={8} />
                      </button>
                    </div>

                    {/* Filter dropdown */}
                    {isFilterOpen && (
                      <div
                        data-filterpop
                        className="absolute left-0 top-full mt-0.5 z-50 bg-panel border border-border rounded-md shadow-lg p-2.5 min-w-[180px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-[10px] text-muted mb-1.5 font-semibold flex items-center gap-1">
                          <I.Filter size={9} className="text-accent" />
                          {f.label}
                        </div>
                        <input
                          ref={filterRef}
                          type="text"
                          placeholder={t("excel.col_filter_placeholder")}
                          value={colFilters[origC] ?? ""}
                          onChange={(e) =>
                            setColFilters((prev) => ({ ...prev, [origC]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") setFilterMenuCol(null);
                          }}
                          className="w-full text-xs border border-border rounded px-2 py-1 bg-bg outline-none focus:border-accent"
                        />
                        {/* Unique value shortcuts */}
                        <div className="mt-1.5 flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
                          {Array.from(
                            new Set(
                              Array.from(
                                { length: NROWS },
                                (_, r) => cellData[r]?.[origC] ?? "",
                              ).filter((v) => v.trim()),
                            ),
                          )
                            .slice(0, 20)
                            .map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => {
                                  setColFilters((prev) => ({ ...prev, [origC]: v }));
                                  setFilterMenuCol(null);
                                }}
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded border truncate max-w-[150px]",
                                  colFilters[origC] === v
                                    ? "bg-accent text-white border-accent"
                                    : "border-border hover:bg-hover",
                                )}
                              >
                                {v}
                              </button>
                            ))}
                        </div>
                        {colFilters[origC] && (
                          <button
                            type="button"
                            onClick={() => {
                              setColFilters((prev) => {
                                const n = { ...prev };
                                delete n[origC];
                                return n;
                              });
                              setFilterMenuCol(null);
                            }}
                            className="mt-1.5 text-[10px] text-danger hover:text-danger/80 flex items-center gap-0.5"
                          >
                            ✕ {t("excel.filter_clear")}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Resize handle — drag: resize cột này; double-click: auto-fit tất cả */}
                    <div
                      data-resize-handle
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40 z-10 group"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        resizingRef.current = {
                          origC,
                          startX: e.clientX,
                          startW: getColWidth(origC),
                        };
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        autoFitAllCols();
                      }}
                    >
                      <div className="absolute right-0 top-1/4 h-1/2 w-px bg-border/60 group-hover:bg-accent/60" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: VISIBLE }, (_, dr) => {
              const rr = visibleRows[dr]!;
              const origRow = rows[rr]!;
              const isDirty = pending.has(rr);
              const rowHighlighted = !!selRange && dr >= selRange.r1 && dr <= selRange.r2;
              const isDataSel = isRowSelected ? isRowSelected(origRow) : false;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: display row index is spreadsheet identity
                <tr key={dr} className={isDirty ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                  {/* Row number */}
                  <td
                    className={cn(
                      "border border-border bg-panel-2/60 text-center text-[10px] text-muted sticky left-0 cursor-pointer hover:bg-accent/10",
                      rowHighlighted && "bg-accent/10 text-accent font-semibold",
                      isDataSel &&
                        "border-l-[3px] border-l-accent bg-accent/20 text-accent font-bold",
                    )}
                    style={{ height: ROW_H }}
                    onClick={() => {
                      setSel({ r: dr, c: 0 });
                      setSelEnd({ r: dr, c: DCOLS - 1 });
                      containerRef.current?.focus();
                      onRowClick?.(origRow);
                    }}
                  >
                    {rr + 1}
                  </td>

                  {colOrder.map((origCInner, dc) => {
                    const isSel = sel?.r === dr && sel?.c === dc;
                    const inRng = inRange(dr, dc);
                    const raw = getCellRaw(dr, dc);
                    const isFormula = raw.startsWith("=");
                    const display = getDisplay(dr, dc);
                    const isError = isFormula && isErr(display);
                    const isEditing = isSel && editing;
                    const cellKey = `${dr},${dc}`;
                    const cellField = fields[origCInner];
                    const isRight = isFormula
                      ? !isError && typeof getCellValue(dr, dc) === "number"
                      : cellField != null && NUMERIC_TYPES.has(cellField.type);
                    const isCenter =
                      !isFormula && cellField != null && BOOL_TYPES.has(cellField.type);

                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: dc la chi so cot hien thi - chinh la danh tinh o trong spreadsheet
                        key={dc}
                        ref={(el) => {
                          if (el) cellRefs.current.set(cellKey, el);
                          else cellRefs.current.delete(cellKey);
                        }}
                        onMouseDown={(e) => {
                          if (editing) commitEdit(true);
                          if (e.shiftKey && selRef.current) {
                            setSelEnd({ r: dr, c: dc });
                          } else {
                            setSel({ r: dr, c: dc });
                            setSelEnd(null);
                            mouseSelecting.current = true;
                            if (selRef.current?.r !== dr) onRowClick?.(origRow);
                          }
                          containerRef.current?.focus();
                        }}
                        onMouseEnter={() => {
                          if (mouseSelecting.current && selRef.current) setSelEnd({ r: dr, c: dc });
                        }}
                        onDoubleClick={() => startEdit(dr, dc)}
                        className={cn(
                          "border border-border/60 overflow-hidden cursor-cell relative",
                          !isSel && inRng && !isMulti && "bg-accent/5",
                          !isSel && inRng && isMulti && "bg-accent/10",
                          isSel &&
                            !isEditing &&
                            "outline outline-2 -outline-offset-1 outline-accent z-[1]",
                          pending.has(rr) && "bg-amber-50/60 dark:bg-amber-900/15",
                        )}
                        style={{ height: ROW_H, padding: 0 }}
                      >
                        {isEditing ? (
                          <div className="relative">
                            <input
                              ref={inputRef}
                              type="text"
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onKeyDown={onEditKeyDown}
                              onBlur={() => {
                                if (suggestions.length === 0) {
                                  commitEdit(true);
                                  if (!batchEdit) void saveRow(dr);
                                }
                              }}
                              className="w-full px-1 bg-white dark:bg-bg outline-none text-xs font-mono border-none"
                              style={{ height: ROW_H }}
                              // biome-ignore lint/a11y/noAutofocus: Excel cell edit mode requires immediate focus
                              autoFocus
                            />
                            {/* Formula autocomplete dropdown */}
                            {suggestions.length > 0 && (
                              <div className="absolute left-0 top-full z-50 bg-panel border border-border rounded shadow-lg min-w-[160px] py-0.5">
                                {suggestions.map((fn, i) => (
                                  <div
                                    key={fn}
                                    className={cn(
                                      "px-2.5 py-0.5 text-xs cursor-pointer font-mono",
                                      i === suggIdx ? "bg-accent text-white" : "hover:bg-hover",
                                    )}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setEditVal(editVal.replace(/([A-Z][A-Z0-9]*)$/i, fn + "("));
                                      setSuggestions([]);
                                      inputRef.current?.focus();
                                    }}
                                  >
                                    {fn}
                                    <span className="ml-2 text-[9px] opacity-60">( )</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span
                            className={cn(
                              "block px-1 truncate text-xs leading-none",
                              isFormula && !isError && "text-accent/90",
                              isError && "text-danger",
                              isRight && "text-right",
                              isCenter && "text-center",
                            )}
                            style={{ lineHeight: `${ROW_H}px` }}
                          >
                            {display}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Summary row */}
            {VISIBLE > 0 && (
              <tr className="sticky bottom-0 bg-panel-2/90 border-t-2 border-border">
                <td
                  className="border border-border text-center text-[9px] text-muted font-semibold"
                  style={{ height: ROW_H }}
                >
                  Σ
                </td>
                {colOrder.map((_, dc) => {
                  const ns = Array.from({ length: VISIBLE }, (__, dr) =>
                    getCellValue(dr, dc),
                  ).filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
                  const sum = ns.reduce((a, b) => a + b, 0);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: col index is identity in spreadsheet
                    <td key={dc} className="border border-border/40 px-1" style={{ height: ROW_H }}>
                      {ns.length > 0 && (
                        <span className="block text-right text-[10px] text-muted font-semibold">
                          {displayVal(sum)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-2.5 px-3 py-0.5 border-t border-border bg-panel-2/40 shrink-0 text-[10px] text-muted flex-wrap">
        {/* row / col count */}
        <span>
          {VISIBLE < NROWS ? (
            <span className="text-accent font-semibold">
              {t("excel.rows_filtered", { visible: VISIBLE, total: NROWS })}
            </span>
          ) : (
            t("excel.rows", { count: NROWS })
          )}
          {" · "}
          {t("excel.cols", { count: DCOLS })}
        </span>

        {/* Active sorts */}
        {sortKeys.length > 0 && (
          <span className="flex items-center gap-1 text-accent">
            <span>{t("excel.sort_label")}</span>
            {sortKeys.map((sk, i) => (
              <span key={sk.col}>
                {i > 0 && <span className="text-muted mx-0.5">›</span>}
                {fields[sk.col]?.label ?? "?"}
                {sk.dir === "asc" ? (
                  <I.ChevronUp size={8} className="inline" />
                ) : (
                  <I.ChevronDown size={8} className="inline" />
                )}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setSortKeys([])}
              className="text-danger/70 hover:text-danger ml-0.5"
              title={t("excel.sort_clear_title")}
            >
              ✕
            </button>
          </span>
        )}

        {/* Selection stats */}
        {sel && (
          <>
            <span className="text-border">|</span>
            <span>
              {isMulti && selRange
                ? t("excel.sel_range", {
                    rows: selRange.r2 - selRange.r1 + 1,
                    cols: selRange.c2 - selRange.c1 + 1,
                  })
                : t("excel.sel_cell", { addr: `${colToLetter(sel.c)}${sel.r + 1}` })}
            </span>
            {selStats && (
              <>
                {selStats.sum !== undefined && (
                  <>
                    <span>{t("excel.stat_sum", { val: displayVal(selStats.sum) })}</span>
                    <span>
                      {t("excel.stat_avg", {
                        val: displayVal(Math.round(selStats.avg! * 100) / 100),
                      })}
                    </span>
                  </>
                )}
                {selStats.count > 1 && (
                  <span>{t("excel.stat_count", { count: selStats.count })}</span>
                )}
              </>
            )}
          </>
        )}

        <span className="ml-auto">
          {totalPending > 0 && (
            <span className="text-warning">
              {t("excel.dirty_rows", { count: totalPending })}
              {!batchEdit ? ` · ${t("excel.auto_save")}` : ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
