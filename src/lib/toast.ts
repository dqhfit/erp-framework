/* ==========================================================
   toast — Helper API gọi nhanh không cần import store.
   ========================================================== */
import { type ToastVariant, useToast } from "@/stores/toast";

interface ToastOpts {
  ttl?: number;
}

function show(message: string, variant: ToastVariant, opts: ToastOpts = {}) {
  return useToast.getState().add(message, variant, opts.ttl);
}

export const toast = {
  success: (message: string, opts?: ToastOpts) => show(message, "success", opts),
  error: (message: string, opts?: ToastOpts) => show(message, "error", opts ?? { ttl: 5000 }),
  info: (message: string, opts?: ToastOpts) => show(message, "info", opts),
  warning: (message: string, opts?: ToastOpts) => show(message, "warning", opts),
  dismiss: (id: string) => useToast.getState().dismiss(id),
};
