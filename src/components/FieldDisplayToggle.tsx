/* ==========================================================
   FieldDisplayToggle — tuỳ chọn TOÀN CỤC hiển thị trường theo
   "tên cột" (name) hay "nhãn" (label). Dùng chung cho mọi designer
   có liệt kê trường (Nguồn dữ liệu, Trang, Workflow). State nằm ở
   useUI (persist) nên đổi ở đâu cũng đồng bộ mọi nơi.
   ========================================================== */

import { Switch } from "@/components/ui/switch";
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

/**
 * Hiển thị đồng thời tên kỹ thuật + nhãn của 1 field — dùng ở designer
 * khi cần thấy cả hai cùng lúc (inspector dropdown, chip, ERD node…).
 * Khi label trùng hoặc trống: chỉ trả name.
 */
export function fieldBoth(f: { name: string; label?: string }): string {
  const label = f.label?.trim() ?? "";
  return label && label !== f.name ? `${label} (${f.name})` : f.name;
}

/** Toggle "Tên cột ↔ Nhãn" dạng switch — đặt ở toolbar/panel của designer. */
export function FieldDisplayToggle({ className }: { className?: string }) {
  const mode = useUI((s) => s.fieldDisplayMode);
  const setMode = useUI((s) => s.setFieldDisplayMode);
  return (
    <Switch
      checked={mode === "label"}
      onChange={(v) => setMode(v ? "label" : "name")}
      label="Nhãn"
      className={cn("text-[11px]", className)}
    />
  );
}
