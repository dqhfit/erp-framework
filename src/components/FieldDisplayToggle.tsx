/* ==========================================================
   FieldDisplayToggle — tuỳ chọn TOÀN CỤC hiển thị trường theo
   "tên cột" (name) hay "nhãn" (label). Dùng chung cho mọi designer
   có liệt kê trường (Nguồn dữ liệu, Trang, Workflow). State nằm ở
   useUI (persist) nên đổi ở đâu cũng đồng bộ mọi nơi.
   ========================================================== */

import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";

/** Hook: trả về chế độ hiện tại + hàm hiển thị tên 1 field theo chế độ. */
export function useFieldDisplay() {
  const mode = useUI((s) => s.fieldDisplayMode);
  /** Tên hiển thị của 1 field (object có name + label tuỳ chọn). */
  const fieldDisp = (f: { name: string; label?: string }) =>
    mode === "label" ? f.label || f.name : f.name;
  return { mode, fieldDisp };
}

/** Toggle segmented "Tên cột | Nhãn" — đặt ở toolbar/panel của designer. */
export function FieldDisplayToggle({
  className,
  label = "Hiển thị trường:",
}: {
  className?: string;
  /** Nhãn đứng trước; truyền "" để ẩn. */
  label?: string;
}) {
  const mode = useUI((s) => s.fieldDisplayMode);
  const setMode = useUI((s) => s.setFieldDisplayMode);
  return (
    <div className={cn("flex items-center gap-2 text-[11px]", className)}>
      {label && <span className="text-muted shrink-0">{label}</span>}
      <div className="flex rounded-md border border-border overflow-hidden shrink-0">
        <button
          type="button"
          onClick={() => setMode("name")}
          className={cn(
            "px-2 py-0.5 transition-colors",
            mode === "name" ? "bg-accent text-white" : "text-muted hover:bg-hover/50",
          )}
        >
          Tên cột
        </button>
        <button
          type="button"
          onClick={() => setMode("label")}
          className={cn(
            "px-2 py-0.5 border-l border-border transition-colors",
            mode === "label" ? "bg-accent text-white" : "text-muted hover:bg-hover/50",
          )}
        >
          Nhãn
        </button>
      </div>
    </div>
  );
}
