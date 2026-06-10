/* ==========================================================
   error-reporter.ts — Bắt lỗi runtime phía client rồi gửi về server
   (errors.report). Nguồn: window "error" (uncaught), "unhandledrejection"
   (promise), và React ErrorBoundary (gọi reportClientError thủ công).

   NGUYÊN TẮC:
   - FAIL-SAFE tuyệt đối: reporter KHÔNG bao giờ ném — lỗi mạng/401 bị nuốt.
     Nếu reporter tự gây lỗi mà ném ra → sẽ kích hoạt lại "error" event →
     vòng lặp. Vì vậy mọi nhánh đều bọc try/catch và swallow.
   - GATE đăng nhập: chỉ gửi khi đã đăng nhập + đã duyệt (endpoint là
     approvedProcedure) — tránh request 401 vô ích trước khi vào app.
   - DEDUPE/THROTTLE: cùng 1 chữ ký lỗi chỉ gửi 1 lần / 30s; trần 50 lần
     gửi / phiên tải trang — chống vòng lặp lỗi làm ngập server.
   - LỌC NOISE: bỏ lỗi tải tài nguyên (img/script) và vài cảnh báo benign.
   ========================================================== */

import { createErrorsClient, type ErrorReportInput } from "@erp-framework/client";
import { useAuth } from "@/stores/auth";

const client = createErrorsClient("");

const DEDUPE_MS = 30_000; // cùng chữ ký: tối đa 1 lần / 30s
const SESSION_CAP = 50; // tổng số lần gửi / phiên tải trang
const recent = new Map<string, number>();
let sentThisSession = 0;
let installed = false;

/** Vài thông điệp benign (không phải bug app) — bỏ qua. */
const IGNORE = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "Non-Error promise rejection captured",
];

/** Chỉ gửi khi đã đăng nhập + đã duyệt (khớp approvedProcedure ở server). */
function canReport(): boolean {
  const s = useAuth.getState();
  return (
    s.status === "in" &&
    !!s.user &&
    s.user.companyApproved !== false &&
    s.user.companyDisabled !== true
  );
}

function shouldThrottle(signature: string): boolean {
  const now = Date.now();
  const last = recent.get(signature);
  if (last && now - last < DEDUPE_MS) return true;
  recent.set(signature, now);
  // Dọn nhẹ map khi phình to.
  if (recent.size > 200) {
    for (const [k, v] of recent) if (now - v > DEDUPE_MS) recent.delete(k);
  }
  return false;
}

/** Gửi 1 lỗi về server. FAIL-SAFE — không bao giờ ném. */
export function reportClientError(input: ErrorReportInput): void {
  try {
    if (!canReport()) return;
    const message = (input.message || "").trim();
    if (!message) return;
    if (IGNORE.some((m) => message.includes(m))) return;
    if (sentThisSession >= SESSION_CAP) return;

    const level = input.level ?? "error";
    const signature = `${level}|${message}`;
    if (shouldThrottle(signature)) return;
    sentThisSession += 1;

    const payload: ErrorReportInput = {
      ...input,
      message: message.slice(0, 4000),
      level,
      url: input.url ?? (typeof location !== "undefined" ? location.href : undefined),
      userAgent:
        input.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : undefined),
      stack: input.stack?.slice(0, 20_000),
      componentStack: input.componentStack?.slice(0, 20_000),
    };
    // Fire-and-forget — nuốt lỗi mạng/401 để không tạo unhandledrejection mới.
    void client.report(payload).catch(() => {});
  } catch {
    /* nuốt — reporter không được phép vỡ app */
  }
}

/** Cài listener toàn cục 1 lần (gọi ở main.tsx). */
export function installGlobalErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // Lỗi tải tài nguyên (img/script/link) → target là element, không phải Error app.
    if (event.target && event.target !== window) return;
    const err = event.error as Error | undefined;
    reportClientError({
      source: "window.onerror",
      message: err?.message || event.message || "Unknown error",
      stack: err?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown;
    let message = "Unhandled promise rejection";
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else if (reason && typeof reason === "object") {
      try {
        message = JSON.stringify(reason).slice(0, 1000);
      } catch {
        /* giữ message mặc định */
      }
    }
    reportClientError({ source: "unhandledrejection", message, stack });
  });
}
