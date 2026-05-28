/* ==========================================================
   ToastHost — Render stack thông báo từ useToast store.
   Mount 1 lần ở __root.tsx. Top-right, fade+slide.
   ========================================================== */
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { useToast } from "@/stores/toast";

interface VariantStyle {
  box: string;
  icon: React.ReactNode;
}
const FALLBACK_STYLE: VariantStyle = {
  box: "bg-bg-soft border-border text-text",
  icon: <I.AlertCircle size={14} />,
};
const VARIANT_STYLES: Record<string, VariantStyle> = {
  success: {
    box: "bg-success/10 border-success/40 text-success",
    icon: <I.Check size={14} />,
  },
  error: {
    box: "bg-danger/10 border-danger/40 text-danger",
    icon: <I.AlertCircle size={14} />,
  },
  warning: {
    box: "bg-warning/10 border-warning/40 text-warning",
    icon: <I.AlertCircle size={14} />,
  },
  info: FALLBACK_STYLE,
};

export function ToastHost() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const style = VARIANT_STYLES[t.variant] ?? FALLBACK_STYLE;
        return (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto min-w-[260px] max-w-[420px] px-3 py-2 rounded-md border shadow-md text-sm",
              "flex items-start gap-2 animate-in fade-in slide-in-from-top-2",
              style.box,
            )}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <div className="flex-1 whitespace-pre-wrap break-words">{t.message}</div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded hover:bg-black/10 text-current opacity-70 hover:opacity-100"
              aria-label="Đóng thông báo"
            >
              <I.X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
