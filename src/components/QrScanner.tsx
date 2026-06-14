/* ==========================================================
   QrScanner — overlay quét QR/barcode bằng camera. Hai đường giải mã:
   - BarcodeDetector API (Chrome Android, vài WebView): nhanh, đa định dạng
     (qr_code, code_128, code_39, ean_13).
   - Fallback jsQR (mọi trình duyệt có camera, kể cả iOS Safari): CHỈ QR.
   Nhờ fallback nên nút quét luôn hiện khi máy có camera (canScanBarcode()).
   Dùng cho trang bản vẽ + nhập sản lượng mobile.
   ========================================================== */
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";

/** Quét được không? Có camera (getUserMedia) là đủ — không cần BarcodeDetector
 *  (trình duyệt thiếu API sẽ rơi về jsQR). */
export function canScanBarcode(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Giữ onResult ổn định để camera không khởi động lại mỗi lần parent re-render.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [err, setErr] = useState("");

  // Chỉ khởi tạo camera 1 lần (onResult đọc qua ref) — deps rỗng có chủ đích.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // BarcodeDetector native nếu có; nếu không → jsQR trên khung hình canvas.
    // biome-ignore lint/suspicious/noExplicitAny: BarcodeDetector chưa có trong lib DOM mặc định
    const Detector = (window as any).BarcodeDetector;
    const detector = Detector
      ? new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] })
      : null;

    const done = (code: string) => {
      if (stopped) return;
      stopped = true;
      onResultRef.current(code);
    };

    const decodeJsQr = (video: HTMLVideoElement): string | null => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const r = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      return r?.data ?? null;
    };

    const tick = async () => {
      if (stopped || !videoRef.current) return;
      const video = videoRef.current;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes?.[0]?.rawValue) {
            done(String(codes[0].rawValue));
            return;
          }
        } else {
          const code = decodeJsQr(video);
          if (code) {
            done(code);
            return;
          }
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
  }, []);

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
