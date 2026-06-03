/* ==========================================================
   FeedbackFab — nút nổi góc phải-dưới, hiện trên mọi route trong app.
   Click → mở SubmitFeedbackModal (tái dùng form gửi phản hồi/đề xuất).
   Là entry point chính, đặc biệt trên mobile (nút Topbar bị ẩn md:).
   ========================================================== */
import { useState } from "react";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";

export function FeedbackFab() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("feedback.fab_title")}
        aria-label={t("feedback.fab_title")}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-transform"
        style={{
          background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
        }}
      >
        <I.MessageSquare size={20} />
      </button>
      <SubmitFeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
