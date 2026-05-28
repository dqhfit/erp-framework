/* ==========================================================
   toast store — Thông báo nhẹ tự ẩn (không chặn UI như dialog).
   Top-right stack, tối đa MAX cùng lúc, FIFO khi tràn.
   ========================================================== */
import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  ttl: number;
}

const MAX = 5;
const DEFAULT_TTL = 3000;

interface ToastState {
  toasts: Toast[];
  add: (message: string, variant?: ToastVariant, ttl?: number) => string;
  dismiss: (id: string) => void;
}

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  add: (message, variant = "info", ttl = DEFAULT_TTL) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((s) => {
      const next = [...s.toasts, { id, message, variant, ttl }];
      // FIFO khi vượt MAX — bỏ toast cũ nhất.
      return { toasts: next.length > MAX ? next.slice(next.length - MAX) : next };
    });
    if (ttl > 0) {
      setTimeout(() => get().dismiss(id), ttl);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
