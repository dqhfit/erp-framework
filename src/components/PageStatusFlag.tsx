/* ==========================================================
   PageStatusFlag — UI cho CỜ trạng thái của trang.

   - PageStatusBadge: chip nhỏ thể hiện 1 cờ (icon + nhãn, màu token).
   - FlagDot: chấm tròn màu (dùng cho danh sách gọn).
   - PageStatusPicker: nút + dropdown chọn/đổi/gỡ cờ cho 1 trang. Dropdown
     render qua PORTAL (position:fixed) → KHÔNG bị cắt khi đặt trong vùng
     cuộn (vd Sidebar). Có lối vào "Quản lý cờ…" mở ManageFlagsModal.
   - ManageFlagsModal: thêm/sửa/xoá "cờ của tôi" (cờ tùy chỉnh per-company).

   Màu luôn đi qua token semantic (FLAG_COLOR_CLASSES) → đổi theo theme.
   ========================================================== */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { Button, FormField, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import {
  BUILTIN_PAGE_FLAGS,
  customFlagToDef,
  FLAG_COLOR_CLASSES,
  FLAG_COLOR_OPTIONS,
  type FlagColor,
  type PageFlagDef,
  resolveFlag,
} from "@/lib/page-status";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

/* ─── Badge + Dot ─────────────────────────────────────────── */
export function PageStatusBadge({
  def,
  size = "sm",
  className,
}: {
  def: PageFlagDef;
  size?: "xs" | "sm";
  className?: string;
}) {
  const c = FLAG_COLOR_CLASSES[def.color];
  const Icon = I[def.icon] ?? I.Tag;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium leading-none",
        size === "xs" ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]",
        c.chip,
        className,
      )}
      title={def.label}
    >
      <Icon size={size === "xs" ? 9 : 11} className="shrink-0" />
      <span className="truncate max-w-[120px]">{def.label}</span>
    </span>
  );
}

export function FlagDot({ color, className }: { color: FlagColor; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        FLAG_COLOR_CLASSES[color].dot,
        className,
      )}
    />
  );
}

/* ─── Picker ──────────────────────────────────────────────── */
export function PageStatusPicker({
  pageId,
  status,
  align = "left",
  size = "sm",
  iconTrigger = false,
}: {
  pageId: string;
  status: string | null | undefined;
  /** Canh mép dropdown so với nút bấm. */
  align?: "left" | "right";
  size?: "xs" | "sm";
  /** true = nút gọn chỉ-icon (cho thanh hành động hẹp, vd Sidebar). */
  iconTrigger?: boolean;
}) {
  const pageFlags = useUserObjects((s) => s.pageFlags);
  const setPageStatus = useUserObjects((s) => s.setPageStatus);
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_W = 224;
  const placeMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = align === "right" ? r.right - MENU_W : r.left;
    // Kẹp trong viewport ngang.
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8));
    setPos({ top: r.bottom + 4, left: clampedLeft });
  };

  // Mở: đo vị trí. Đóng khi click ngoài / cuộn / resize / Esc.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placeMenu định nghĩa trong component (đổi mỗi render) — chỉ chạy khi `open` đổi, thêm vào deps gây re-bind listener vô ích
  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const def = resolveFlag(status, pageFlags);
  const customDefs = pageFlags.map(customFlagToDef);

  const pick = (value: string | null) => {
    setPageStatus(pageId, value);
    setOpen(false);
  };

  const FlagRow = ({ d }: { d: PageFlagDef }) => {
    const active = d.value === status;
    const Icon = I[d.icon] ?? I.Tag;
    return (
      <button
        type="button"
        onClick={() => pick(d.value)}
        className={cn(
          "w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-hover/60 transition-colors",
          active && "bg-accent/10",
        )}
      >
        <Icon size={13} className={cn("shrink-0", FLAG_COLOR_CLASSES[d.color].text)} />
        <span className="truncate flex-1">{d.label}</span>
        {active && <I.Check size={12} className="ml-auto text-accent shrink-0" />}
      </button>
    );
  };

  const TrigIcon = def ? (I[def.icon] ?? I.Tag) : I.Tag;

  return (
    <>
      {iconTrigger ? (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "w-5 h-5 rounded-sm flex items-center justify-center transition-colors",
            def
              ? FLAG_COLOR_CLASSES[def.color].text
              : "text-muted/40 hover:bg-hover/80 hover:text-accent",
          )}
          title={def ? `Cờ: ${def.label}` : "Gắn cờ trạng thái"}
        >
          <TrigIcon size={12} />
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded border transition-colors",
            size === "xs" ? "h-5 px-1 text-[10px]" : "h-6 px-1.5 text-[11px]",
            def
              ? cn(FLAG_COLOR_CLASSES[def.color].chip, "hover:brightness-110")
              : "border-border text-muted hover:text-text hover:bg-hover/60",
          )}
          title={def ? `Cờ: ${def.label}` : "Gắn cờ trạng thái"}
        >
          {def ? (
            <>
              <TrigIcon size={size === "xs" ? 10 : 12} className="shrink-0" />
              <span className="truncate max-w-[110px]">{def.label}</span>
            </>
          ) : (
            <I.Tag size={size === "xs" ? 10 : 12} className="shrink-0" />
          )}
          <I.ChevronDown size={9} className="shrink-0 opacity-60" />
        </button>
      )}

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[950] bg-panel border border-border rounded-md shadow-xl py-1 text-sm max-h-[70vh] overflow-y-auto"
          >
            <div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted/60 font-semibold">
              Trạng thái
            </div>
            {BUILTIN_PAGE_FLAGS.map((d) => (
              <FlagRow key={d.value} d={d} />
            ))}
            {customDefs.length > 0 && (
              <>
                <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted/60 font-semibold">
                  Cờ của tôi
                </div>
                {customDefs.map((d) => (
                  <FlagRow key={d.value} d={d} />
                ))}
              </>
            )}
            <div className="border-t border-border my-1" />
            {status && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 text-muted hover:bg-hover/60 transition-colors"
              >
                <I.X size={13} className="shrink-0" /> Bỏ cờ
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setManageOpen(true);
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 text-accent hover:bg-hover/60 transition-colors"
            >
              <I.Settings size={13} className="shrink-0" /> Quản lý cờ…
            </button>
          </div>,
          document.body,
        )}

      <ManageFlagsModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </>
  );
}

/* ─── Quản lý cờ tùy chỉnh ────────────────────────────────── */
export function ManageFlagsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pageFlags = useUserObjects((s) => s.pageFlags);
  const savePageFlag = useUserObjects((s) => s.savePageFlag);
  const deletePageFlag = useUserObjects((s) => s.deletePageFlag);

  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<FlagColor>("accent");
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setEditId(null);
    setLabel("");
    setColor("accent");
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ reset khi đóng/mở, không phụ thuộc resetForm
  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const lbl = label.trim();
    if (!lbl) return;
    setBusy(true);
    await savePageFlag({ id: editId ?? undefined, label: lbl, color });
    setBusy(false);
    resetForm();
  };

  const startEdit = (id: string) => {
    const f = pageFlags.find((x) => x.id === id);
    if (!f) return;
    setEditId(f.id);
    setLabel(f.label);
    setColor(f.color);
  };

  const remove = async (id: string, name: string) => {
    const ok = await dialog.confirm(`Xoá cờ "${name}"? Mọi trang đang gắn cờ này sẽ bị gỡ cờ.`, {
      title: "Xoá cờ",
      confirmText: "Xoá",
      danger: true,
    });
    if (!ok) return;
    deletePageFlag(id);
    if (editId === id) resetForm();
  };

  return createPortal(
    <div className="fixed inset-0 z-[960] overflow-y-auto">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div className="flex min-h-full items-center justify-center px-3 py-6">
        <div
          role="dialog"
          aria-modal="true"
          className="relative panel rounded-lg shadow-2xl flex flex-col w-full max-w-[460px] max-h-[calc(100vh-3rem)] overflow-hidden"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
            <div className="font-semibold text-lg flex items-center gap-2">
              <I.Tag size={16} className="text-accent" /> Quản lý cờ của tôi
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />} />
          </div>

          <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
            {/* Danh sách cờ tùy chỉnh hiện có */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted/60 font-semibold mb-1.5">
                Cờ tùy chỉnh ({pageFlags.length})
              </div>
              {pageFlags.length === 0 ? (
                <div className="text-xs text-muted py-2">
                  Chưa có cờ riêng. Thêm cờ mới ở bên dưới — ngoài bộ trạng thái mặc định.
                </div>
              ) : (
                <ul className="space-y-1">
                  {pageFlags.map((f) => (
                    <li
                      key={f.id}
                      className={cn(
                        "flex items-center gap-2 rounded border border-border px-2 py-1.5",
                        editId === f.id && "ring-1 ring-accent/50",
                      )}
                    >
                      <FlagDot color={f.color} />
                      <span className="flex-1 truncate text-sm">{f.label}</span>
                      <button
                        type="button"
                        onClick={() => startEdit(f.id)}
                        title="Sửa"
                        className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-accent hover:bg-hover/60"
                      >
                        <I.Edit size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(f.id, f.label)}
                        title="Xoá"
                        className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-danger hover:bg-hover/60"
                      >
                        <I.Trash size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Form thêm / sửa */}
            <div className="border-t border-border pt-3 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-muted/60 font-semibold">
                {editId ? "Sửa cờ" : "Thêm cờ mới"}
              </div>
              <FormField label="Tên cờ">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Vd: Cần kiểm tra, Ưu tiên cao…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </FormField>
              <FormField label="Màu">
                <div className="flex flex-wrap gap-1.5">
                  {FLAG_COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setColor(opt.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors",
                        color === opt.value
                          ? FLAG_COLOR_CLASSES[opt.value].chip
                          : "border-border text-muted hover:bg-hover/50",
                      )}
                    >
                      <FlagDot color={opt.value} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
          </div>

          <div className="p-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
            {editId && (
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Huỷ sửa
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={editId ? <I.Check size={13} /> : <I.Plus size={13} />}
              onClick={() => void submit()}
              disabled={busy || !label.trim()}
            >
              {editId ? "Lưu" : "Thêm cờ"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
