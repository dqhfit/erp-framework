/* ==========================================================
   QrScanner — overlay quét QR/barcode bằng camera. Hai đường giải mã:
   - BarcodeDetector API (Chrome Android, vài WebView): nhanh, đa định dạng
     (qr_code, code_128, code_39, ean_13).
   - Fallback jsQR (mọi trình duyệt có camera, kể cả iOS Safari): CHỈ QR.
   Nhờ fallback nên nút quét luôn hiện khi máy có camera (canScanBarcode()).
   Tối ưu: tắt HẲN camera khi đóng/đổi (stop tracks + clear srcObject), khung
   ngắm gọn (mask tối + 4 góc), đổi camera trước/sau (mặc định CAMERA SAU).
   Dùng cho trang bản vẽ + nhập sản lượng mobile.
   ========================================================== */
// jsqr không import tĩnh — tải động lần đầu dùng (fallback path, không trên mọi thiết bị).
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";

/** Quét được không? Có camera (getUserMedia) là đủ — không cần BarcodeDetector
 *  (trình duyệt thiếu API sẽ rơi về jsQR). */
export function canScanBarcode(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

type Facing = "environment" | "user";

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
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  // Giữ onResult ổn định để camera không khởi động lại mỗi lần parent re-render.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [facing, setFacing] = useState<Facing>("environment"); // ưu tiên camera SAU
  const [hasMultiCam, setHasMultiCam] = useState(false);
  const [err, setErr] = useState("");

  /** Tắt HẲN: dừng mọi track + gỡ srcObject (đèn camera tắt ngay). */
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    for (const tr of streamRef.current?.getTracks() ?? []) tr.stop();
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
    }
  }, []);

  const close = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  // Khởi tạo / đổi camera theo `facing`. Cleanup tắt hẳn trước khi mở lại.
  useEffect(() => {
    let cancelled = false;
    let done = false;
    setErr("");
    // biome-ignore lint/suspicious/noExplicitAny: BarcodeDetector chưa có trong lib DOM mặc định
    const Detector = (window as any).BarcodeDetector;
    const detector = Detector
      ? new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] })
      : null;

    // Dynamic import jsqr: chỉ tải khi BarcodeDetector không có (fallback).
    // Module được cache sau lần tải đầu → các khung tiếp theo không tốn network.
    const decodeJsQr = async (video: HTMLVideoElement): Promise<string | null> => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const jsQR = (await import("jsqr")).default;
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

    const finish = (code: string) => {
      done = true;
      stopCamera();
      onResultRef.current(code);
    };

    const tick = async () => {
      if (cancelled || done || !videoRef.current) return;
      const video = videoRef.current;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes?.[0]?.rawValue) return finish(String(codes[0].rawValue));
        } else {
          const code = await decodeJsQr(video);
          if (code) return finish(code);
        }
      } catch {
        /* khung lỗi — bỏ qua, thử khung sau */
      }
      rafRef.current = requestAnimationFrame(() => void tick());
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing } })
      .then((s) => {
        if (cancelled) {
          for (const tr of s.getTracks()) tr.stop(); // unmount/đổi giữa chừng → tắt ngay
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
          rafRef.current = requestAnimationFrame(() => void tick());
        }
        // Có ≥2 camera thì mới hiện nút đổi.
        navigator.mediaDevices
          .enumerateDevices?.()
          .then((ds) => {
            if (!cancelled) setHasMultiCam(ds.filter((d) => d.kind === "videoinput").length >= 2);
          })
          .catch(() => {});
      })
      .catch((e) => {
        if (!cancelled) setErr(`Không mở được camera: ${(e as Error).message}`);
      });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [facing, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border">
        <span className="text-sm font-medium flex-1">{title}</span>
        {hasMultiCam && !err && (
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            className="p-1.5 rounded hover:bg-hover text-muted"
            aria-label="Đổi camera trước/sau"
            title="Đổi camera trước/sau"
          >
            <I.SwitchCamera size={18} />
          </button>
        )}
        <button
          type="button"
          onClick={close}
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
        <div className="flex-1 relative overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          {/* Khung ngắm: mask tối xung quanh + 4 góc nhấn cho gọn mắt. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="relative w-64 h-64 max-w-[78vw] max-h-[78vw] rounded-2xl"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            >
              <span className="absolute -top-px -left-px w-8 h-8 border-t-2 border-l-2 border-accent rounded-tl-2xl" />
              <span className="absolute -top-px -right-px w-8 h-8 border-t-2 border-r-2 border-accent rounded-tr-2xl" />
              <span className="absolute -bottom-px -left-px w-8 h-8 border-b-2 border-l-2 border-accent rounded-bl-2xl" />
              <span className="absolute -bottom-px -right-px w-8 h-8 border-b-2 border-r-2 border-accent rounded-br-2xl" />
            </div>
          </div>
          <div className="absolute left-0 right-0 bottom-8 text-center text-white/80 text-xs px-4 pointer-events-none">
            Đưa mã QR vào trong khung
          </div>
        </div>
      )}
    </div>
  );
}
