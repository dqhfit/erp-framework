/* ==========================================================
   settings.shortcuts — Xem + thiết lập phím tắt bàn phím.
   Override lưu THEO TÀI KHOẢN tại preferences.shortcuts (sync server).
   Bấm "Đổi" → ghi lại tổ hợp phím tiếp theo; "Mặc định" → khôi phục.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Kbd } from "@/components/ui";
import { useResolvedShortcuts } from "@/hooks/useShortcut";
import {
  eventToCombo,
  formatCombo,
  SHORTCUT_CATEGORIES,
  SHORTCUT_REFERENCE,
} from "@/lib/shortcuts";
import { usePreferences } from "@/stores/preferences";

function ShortcutsSettings() {
  const resolved = useResolvedShortcuts();
  const overrides = usePreferences((s) => s.prefs.shortcuts);
  const savePrefs = usePreferences((s) => s.save);
  const [capturing, setCapturing] = useState<string | null>(null);

  /** Đặt combo cho 1 shortcut. combo=null → khôi phục mặc định (set undefined,
   *  resolve sẽ fallback defaultCombo; JSON bỏ key undefined khi lưu server). */
  const setCombo = (id: string, combo: string | null) => {
    savePrefs({ shortcuts: { ...(overrides ?? {}), [id]: combo ?? undefined } });
  };

  // Ghi lại phím khi đang ở chế độ "Đổi". Dùng capture-phase + preventDefault để
  // không kích hoạt phím tắt khác / không gõ vào đâu. Esc = huỷ ghi.
  // Đọc/ghi preferences qua getState() để effect chỉ phụ thuộc `capturing`
  // (tránh stale-closure + thoả useExhaustiveDependencies).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // mới chỉ bấm modifier → chờ phím chính
      const st = usePreferences.getState();
      st.save({ shortcuts: { ...(st.prefs.shortcuts ?? {}), [capturing]: combo } });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  // Phát hiện trùng: combo nào được ≥2 shortcut dùng.
  const conflicts = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of resolved) count.set(s.combo, (count.get(s.combo) ?? 0) + 1);
    return count;
  }, [resolved]);

  const anyOverride = overrides && Object.values(overrides).some((v) => v != null);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-3 sm:p-8">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-xl font-semibold">Phím tắt</h1>
          {anyOverride && (
            <Button
              variant="ghost"
              size="sm"
              icon={<I.RefreshCw size={13} />}
              onClick={() => savePrefs({ shortcuts: {} })}
            >
              Khôi phục tất cả
            </Button>
          )}
        </div>
        <div className="text-sm text-muted mb-6">
          Xem và tự đặt phím tắt. Thiết lập được lưu theo tài khoản và đồng bộ giữa các thiết bị.
          Bấm <b>Đổi</b> rồi nhấn tổ hợp phím mong muốn (Esc để huỷ).
        </div>

        {SHORTCUT_CATEGORIES.map((cat) => {
          const items = resolved.filter((s) => s.category === cat.key);
          if (items.length === 0) return null;
          return (
            <Card key={cat.key} className="mb-4">
              <div className="mb-1 font-semibold">{cat.label}</div>
              <div className="text-xs text-muted mb-3">{cat.hint}</div>
              <div className="divide-y divide-border">
                {items.map((s) => {
                  const isCapturing = capturing === s.id;
                  const isOverridden = overrides?.[s.id] != null;
                  const conflict = (conflicts.get(s.combo) ?? 0) > 1;
                  return (
                    <div key={s.id} className="flex items-center gap-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{s.label}</div>
                        <div className="text-xs text-muted truncate">{s.desc}</div>
                      </div>
                      {conflict && !isCapturing && (
                        <span title="Trùng với phím tắt khác">
                          <Chip variant="warning">Trùng</Chip>
                        </span>
                      )}
                      {isCapturing ? (
                        <span className="text-xs text-accent animate-pulse w-[120px] text-right">
                          Đang chờ phím…
                        </span>
                      ) : (
                        <Kbd>{formatCombo(s.combo)}</Kbd>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {isCapturing ? (
                          <Button variant="ghost" size="sm" onClick={() => setCapturing(null)}>
                            Huỷ
                          </Button>
                        ) : (
                          <Button variant="default" size="sm" onClick={() => setCapturing(s.id)}>
                            Đổi
                          </Button>
                        )}
                        {isOverridden && !isCapturing && (
                          <button
                            type="button"
                            onClick={() => setCombo(s.id, null)}
                            title="Khôi phục mặc định"
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
                          >
                            <I.RefreshCw size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {/* Tham khảo — phím tắt CỐ ĐỊNH theo từng màn hình (không đổi được). */}
        <div className="mt-8 mb-3">
          <h2 className="text-lg font-semibold">Phím tắt theo màn hình</h2>
          <div className="text-sm text-muted">
            Các phím gắn cứng trong từng màn hình chức năng (không tự đổi được). Phím Trình dựng
            trang ở mục trên có thể tuỳ chỉnh. <b>Ctrl/Cmd</b> = Ctrl (Windows/Linux) hoặc ⌘
            (macOS).
          </div>
        </div>
        {SHORTCUT_REFERENCE.map((g) => (
          <Card key={g.scope} className="mb-4">
            <div className="mb-1 font-semibold">{g.scope}</div>
            {g.hint && <div className="text-xs text-muted mb-3">{g.hint}</div>}
            <div className="divide-y divide-border">
              {g.items.map((it) => (
                <div key={it.action} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0 text-sm text-muted">{it.action}</div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {it.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}

        <div className="text-xs text-muted">
          Gợi ý: <Kbd>{formatCombo("mod+k")}</Kbd> hoặc <Kbd>/</Kbd> mở Command Palette để tìm nhanh
          mọi thứ.
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/shortcuts")({ component: ShortcutsSettings });
