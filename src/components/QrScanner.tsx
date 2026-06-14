/* ==========================================================
   QrScanner — overlay quét QR/barcode bằng camera (BarcodeDetector API,
   Chrome Android). Dùng cho trang bản vẽ + nhập sản lượng mobile.
   Thiếu API thì caller tự ẩn nút mở scanner (canScanBarcode()).
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";

/** BarcodeDetector có sẵn trên trình duyệt? (Chrome Android, một số WebView). */
export function canScanBarcode(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function QrScanner({
  title = "Quét mã",
  onResult,
  onClose,
}: {
  title?: string;
  onResult: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // biome-ignore lint/suspicious/noExplicitAny: BarcodeDetector chưa có trong lib DOM mặc định
    const Detector = (window as any).BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });

    const tick = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes?.[0]?.rawValue) {
          onResult(String(codes[0].rawValue));
          return;
        }
      } catch {
        /* khung lỗi — bỏ qua, thử khung sau */
      }
      raf = requestAnimationFrame(() => void tick());
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
          raf = requestAnimationFrame(() => void tick());
        }
      })
      .catch((e) => setErr(`Không mở được camera: ${(e as Error).message}`));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      for (const tr of stream?.getTracks() ?? []) tr.stop();
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border">
        <span className="text-sm font-medium flex-1">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-hover text-muted"
          aria-label="Đóng"
        >
          <I.X size={18} />
        </button>
      </div>
      {err ? (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-danger text-center">
          {err}
        </div>
      ) : (
        <div className="flex-1 relative">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-56 h-56 border-2 border-accent/80 rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
