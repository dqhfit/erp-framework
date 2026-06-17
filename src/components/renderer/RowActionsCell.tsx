/* ==========================================================
   RowActionsCell — ô cột "Hành động" gọn: 1 nút ⋯, RÊ CHUỘT (hoặc bấm) hiện
   POPOVER lưới icon hành động. Gồm:
   - Hành động cấu hình/dựng sẵn (Xem/Sửa/Xoá…) — render ActionWidget (đã bind id).
   - Quick-action client-side luôn có (sao chép/xuất/in/xem JSON…) — thao tác trực
     tiếp trên dữ liệu dòng, không cần backend.
   Mặc định (rowActionsBuiltin) = 3 hành động entity + 8 quick = 11 icon.
   Popover portal ra <body> để không bị overflow của bảng cắt; đóng trễ để rê
   chuột vào trong bấm được.
   ========================================================== */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { dialog } from "@/lib/dialog";
import type { PageStateLike } from "@/lib/run-action";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { ActionConfig } from "@/types/page";

export interface RowActionColInfo {
  key: string;
  label: string;
}

interface Props {
  /** Hành động entity (Xem/Sửa/Xoá + cấu hình) — đã bind id dòng. */
  actions: ActionConfig[];
  pageState: PageStateLike;
  /** Dữ liệu dòng — cho quick-action client (sao chép/xuất/in). */
  row: Record<string, unknown>;
  /** Cột hiển thị (key + nhãn) — dựng TSV/CSV/in. */
  cols: RowActionColInfo[];
  /** Tên field id (mặc định dò id/ID/_id). */
  idField?: string;
  /** Nhãn dùng cho tiêu đề in / tên file. */
  title?: string;
  /** Danh sách KEY nút bị ẩn (cài đặt list) — entity theo label (Xem/Sửa/Xoá +
   *  label cấu hình), quick-action theo key (vd "copy-json"). */
  hidden?: string[];
}

/** Key built-in entity (= label) — để cài đặt bật/tắt nút. */
export const ROW_BUILTIN_ACTION_KEYS = ["Xem", "Sửa", "Xoá"] as const;

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    toast.error("Không sao chép được (trình duyệt chặn clipboard)");
  }
}

const csvEsc = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const htmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function downloadCsvRow(row: Record<string, unknown>, cols: RowActionColInfo[], name: string) {
  const head = cols.map((c) => csvEsc(c.label)).join(",");
  const body = cols.map((c) => csvEsc(String(row[c.key] ?? ""))).join(",");
  const blob = new Blob([`﻿${head}\r\n${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name || "dong"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printRow(row: Record<string, unknown>, cols: RowActionColInfo[], title: string) {
  const body = cols
    .map(
      (c) =>
        `<tr><th style="text-align:left;padding:4px 10px;border:1px solid #ccc;background:#f3f4f6;white-space:nowrap">${htmlEsc(
          c.label,
        )}</th><td style="padding:4px 10px;border:1px solid #ccc">${htmlEsc(String(row[c.key] ?? ""))}</td></tr>`,
    )
    .join("");
  const w = window.open("", "_blank", "width=760,height=900");
  if (!w) {
    toast.error("Trình duyệt chặn cửa sổ in");
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title></head><body style="font-family:system-ui,sans-serif;font-size:13px;color:#111"><h3>${htmlEsc(
      title,
    )}</h3><table style="border-collapse:collapse">${body}</table><script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
}

/** Vị trí popover: ngay dưới nút, kẹp trong viewport. */
function pos(rect: DOMRect) {
  const m = 6;
  const w = 300;
  let left = rect.right - w;
  if (left < m) left = m;
  if (left + w > window.innerWidth - m) left = window.innerWidth - m - w;
  let top = rect.bottom + 4;
  // Hết chỗ dưới → lật lên trên.
  if (top + 120 > window.innerHeight - m) top = Math.max(m, rect.top - 120);
  return { left, top, width: w };
}

/** Quick-action client-side (key + nhãn + icon). Nguồn DUY NHẤT cho danh mục
 *  bật/tắt (designer) lẫn render. */
const QUICK_META = [
  { key: "copy-row", label: "Sao chép dòng (dán Excel)", icon: I.Copy },
  { key: "copy-kv", label: "Sao chép (cột: giá trị)", icon: I.ClipboardList },
  { key: "copy-json", label: "Sao chép JSON", icon: I.Braces },
  { key: "copy-id", label: "Sao chép mã (ID)", icon: I.Hash },
  { key: "copy-link", label: "Sao chép liên kết trang", icon: I.Link },
  { key: "csv", label: "Xuất CSV (dòng)", icon: I.Download },
  { key: "view-json", label: "Xem JSON", icon: I.FileText },
  { key: "print", label: "In dòng", icon: I.Printer },
] as const;

/** Danh mục nút có thể bật/tắt (cài đặt list): 3 entity built-in + 8 quick. */
export const ROW_ACTION_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  ...ROW_BUILTIN_ACTION_KEYS.map((k) => ({ key: k, label: k })),
  ...QUICK_META.map((q) => ({ key: q.key, label: q.label })),
];

export function RowActionsCell({ actions, pageState, row, cols, idField, title, hidden }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const idVal = row[idField ?? "id"] ?? row.id ?? row.ID ?? row._id;

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };
  const doOpen = () => {
    cancelClose();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };
  const onEnter = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(doOpen, 120);
  };
  const onLeave = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    scheduleClose();
  };

  const hiddenSet = new Set(hidden ?? []);
  // Hành vi từng quick-action (theo key) — khớp QUICK_META.
  const runners: Record<string, () => void> = {
    "copy-row": () =>
      copyText(cols.map((c) => String(row[c.key] ?? "")).join("\t"), "Đã sao chép dòng"),
    "copy-kv": () =>
      copyText(cols.map((c) => `${c.label}: ${row[c.key] ?? ""}`).join("\n"), "Đã sao chép"),
    "copy-json": () => copyText(JSON.stringify(row, null, 2), "Đã sao chép JSON"),
    "copy-id": () => copyText(String(idVal ?? ""), "Đã sao chép mã"),
    "copy-link": () => copyText(window.location.href, "Đã sao chép liên kết"),
    csv: () => downloadCsvRow(row, cols, `dong-${idVal ?? ""}`),
    "view-json": () =>
      void dialog.alert(JSON.stringify(row, null, 2), { title: "Dữ liệu dòng (JSON)" }),
    print: () => printRow(row, cols, title ?? "Chi tiết dòng"),
  };
  const quick = QUICK_META.filter((q) => !hiddenSet.has(q.key)).map((q) => ({
    ...q,
    run: runners[q.key] ?? (() => {}),
  }));
  // Hành động entity ẩn theo LABEL (Xem/Sửa/Xoá + label cấu hình).
  const shownActions = actions.filter((a) => !hiddenSet.has(a.label));

  const p = rect ? pos(rect) : null;

  // Ẩn hết → không hiện nút ⋯.
  if (shownActions.length === 0 && quick.length === 0) return null;

  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={() => (open ? setOpen(false) : doOpen())}
        title="Hành động"
        aria-label="Hành động"
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors",
          open
            ? "border-accent/60 text-accent bg-accent/10"
            : "border-border text-muted hover:text-text hover:border-border",
        )}
      >
        <I.MoreHorizontal size={14} />
      </button>
      {open &&
        p &&
        createPortal(
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ left: p.left, top: p.top, width: p.width }}
            className="fixed z-[900] rounded-lg border border-border bg-panel p-1.5 shadow-2xl"
          >
            {shownActions.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2 pb-1.5 mb-1.5 border-b border-border">
                {shownActions.map((a) => (
                  <ActionWidget key={a.label} config={a} pageState={pageState} inline />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {quick.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  title={q.label}
                  aria-label={q.label}
                  onClick={() => {
                    q.run();
                    setOpen(false);
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text"
                >
                  <q.icon size={15} />
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
