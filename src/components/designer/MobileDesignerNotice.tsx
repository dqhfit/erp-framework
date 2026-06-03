import { I } from "@/components/Icons";

/** Banner nhắc trình thiết kế (canvas kéo-thả) tối ưu cho màn lớn.
   Hiển thị trên mobile phía trên canvas read-only. */
export function MobileDesignerNotice({ message }: { message?: string }) {
  return (
    <div className="shrink-0 flex items-start gap-2 px-3 py-2 bg-warning/10 border-b border-warning/30 text-warning text-xs">
      <I.Info size={14} className="shrink-0 mt-0.5" />
      <span>
        {message ??
          "Trình thiết kế tối ưu cho màn hình lớn. Trên điện thoại bạn có thể xem (kéo để di chuyển, chụm để phóng to) — hãy dùng máy tính để chỉnh sửa bố cục."}
      </span>
    </div>
  );
}
