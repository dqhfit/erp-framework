/* ==========================================================
   auth — Phiên đăng nhập. Backend (RBAC) yêu cầu đăng nhập nên
   toàn app nằm sau cổng AuthGate. Đăng nhập xong → nạp dữ liệu
   low-code bằng useUserObjects.hydrate().
   ========================================================== */
import { create } from "zustand";
import { createAuthClient } from "@erp-framework/client";
import { useUserObjects } from "./userObjects";
import { t } from "@/hooks/useT";

const auth = createAuthClient("");

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  status: "checking" | "out" | "in";
  user: AuthUser | null;
  error: string;
  check: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** Đặt user + nạp dữ liệu low-code. */
function enter(set: (p: Partial<AuthState>) => void, user: AuthUser): void {
  set({ status: "in", user, error: "" });
  void useUserObjects.getState().hydrate();
}

export const useAuth = create<AuthState>()((set) => ({
  status: "checking",
  user: null,
  error: "",

  check: async () => {
    try {
      const u = (await auth.me()) as AuthUser;
      enter(set, u);
    } catch {
      set({ status: "out", user: null });
    }
  },

  login: async (email, password) => {
    try {
      const u = (await auth.login(email, password)) as AuthUser;
      enter(set, u);
    } catch (e) {
      set({ error: (e as Error).message || t("auth.login_failed") });
    }
  },

  register: async (email, name, password) => {
    try {
      await auth.register(email, name, password);
      // register không tạo phiên — đăng nhập ngay để lấy cookie.
      const u = (await auth.login(email, password)) as AuthUser;
      enter(set, u);
    } catch (e) {
      set({ error: (e as Error).message || t("auth.register_failed") });
    }
  },

  logout: async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    set({ status: "out", user: null });
  },
}));
