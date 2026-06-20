/* Tab "Hành động" của inspector PageDesigner: thanh hành động cho widget
   actionbar + thanh hành động nhúng / cột hành động dòng cho list/form/detail.
   Tách từ PageDesigner.tsx (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { ActionBarInspector } from "@/components/designer/inspectors/inspector-helpers";
import type { ActionBarItem, PageComponent } from "@/components/designer/page-designer-constants";
import { ROW_ACTION_OPTIONS } from "@/components/renderer/RowActionsCell";
import { FormField, Select, Switch } from "@/components/ui";

export function HanhDongInspector({
  sel,
  update,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
}) {
  return (
    <>
      {sel.kind === "actionbar" && (
        <ActionBarInspector
          items={(sel.config.items as ActionBarItem[] | undefined) ?? []}
          align={(sel.config.align as "left" | "right" | "between") ?? "left"}
          compact={sel.config.compact === true}
          onChange={(items, align) => update(sel.id, { config: { ...sel.config, items, align } })}
          onCompactChange={(v) =>
            update(sel.id, { config: { ...sel.config, compact: v || undefined } })
          }
        />
      )}

      {/* ── Cột hành động theo dòng (Xem/Sửa/Xoá + sao chép/in…) ── */}
      {sel.kind === "list" && (
        <div className="space-y-2 pb-2 border-b border-border/40">
          <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
            <div className="flex flex-col leading-tight">
              <span className="text-sm">Cột hành động</span>
              <span className="text-[11px] text-muted">
                Thêm cột hành động cho từng dòng: Xem · Sửa · Xoá (+ sao chép / xuất / in…). Mặc
                định ẩn.
              </span>
            </div>
            <Switch
              checked={sel.config.rowActionsBuiltin === true}
              onChange={(v) => update(sel.id, { config: { ...sel.config, rowActionsBuiltin: v } })}
            />
          </div>
          {sel.config.rowActionsBuiltin === true && (
            <>
              <FormField label="Kiểu hiển thị">
                <Select
                  value={(sel.config.rowActionsStyle as string) ?? "inline"}
                  onChange={(e) =>
                    update(sel.id, {
                      config: { ...sel.config, rowActionsStyle: e.target.value },
                    })
                  }
                >
                  <option value="inline">Inline (nút Xem · Sửa · Xoá)</option>
                  <option value="popover">Popover (nút ⋯ gọn)</option>
                </Select>
              </FormField>
              {((sel.config.rowActionsStyle as string) ?? "inline") === "popover" && (
                <div className="p-2.5 rounded-md border border-border bg-bg-soft">
                  <div className="text-sm mb-0.5">Nút hiện trên popover</div>
                  <div className="text-[11px] text-muted mb-2">
                    Bỏ tích để ẩn nút khỏi popover ⋯
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {ROW_ACTION_OPTIONS.map((opt) => {
                      const hidden = (sel.config.rowActionsHidden as string[] | undefined) ?? [];
                      return (
                        <label
                          key={opt.key}
                          className="flex items-center gap-1.5 text-[12px] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="accent-accent shrink-0"
                            checked={!hidden.includes(opt.key)}
                            onChange={(e) => {
                              const h = (sel.config.rowActionsHidden as string[] | undefined) ?? [];
                              const next = e.target.checked
                                ? h.filter((k) => k !== opt.key)
                                : [...h, opt.key];
                              update(sel.id, {
                                config: { ...sel.config, rowActionsHidden: next },
                              });
                            }}
                          />
                          <span className="truncate">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Thanh hành động nhúng — list / form / detail ── */}
      {(sel.kind === "list" || sel.kind === "form" || sel.kind === "detail") && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <ActionBarInspector
            items={(sel.config.embeddedActions as ActionBarItem[] | undefined) ?? []}
            align="left"
            embedded
            onChange={(items) =>
              update(sel.id, { config: { ...sel.config, embeddedActions: items } })
            }
          />
        </div>
      )}
    </>
  );
}
