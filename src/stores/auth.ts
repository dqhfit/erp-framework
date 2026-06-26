import { type AgentMemberRole, createAuthClient, createObjectsClient } from "@erp-framework/client";
/* ==========================================================
   auth — Phiên đăng nhập. Backend (RBAC) yêu cầu đăng nhập nên
   toàn app nằm sau cổng AuthGate. Đăng nhập xong → nạp dữ liệu
   low-code bằng useUserObjects.hydrate().

   Thêm: primaryAgentId + myAgentRoles — chứa map agentId → role
   (owner/operator/observer) để Sidebar pin + Topbar chip biết
   "agent của tôi" và RBAC client-side hiển thị nút Quản lý.
   ========================================================== */
import { create } from "zustand";
import { t } from "@/hooks/useT";
import { closeRealtime } from "@/lib/realtime";
import { useUserObjects } from "./userObjects";

const auth = createAuthClient("");
const api = createObjectsClient("");

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** false = dang ky qua invite link, cho admin duyet. */
  companyApproved?: boolean;
  /** true = admin da vo hieu hoa tai khoan trong cong ty nay. */
  companyDisabled?: boolean;
}

interface AuthState {
  status: "checking" | "out" | "in";
  user: AuthUser | null;
  /** Đăng ký có mở không (chưa có admin nào). null = chưa biết. Khi false,
   *  màn đăng nhập ẩn nút chuyển sang đăng ký. */
  registrationOpen: boolean | null;
  error: string;
  /** Code TRPCError gần nhất (FORBIDDEN, UNAUTHORIZED, TOO_MANY_REQUESTS…)
     — UI dùng để rẽ nhánh (vd auto-switch register→login khi first-admin-only). */
  errorCode: string | null;
  /** Agent chính (null = chưa chọn) — Topbar/AgentPanel ưu tiên bind. */
  primaryAgentId: string | null;
  /** Role per cặp (user, agent) — agentId → role. Trống = không phải member. */
  myAgentRoles: Record<string, AgentMemberRole>;
  check: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Xóa error + errorCode (sau khi UI consume). */
  clearError: () => void;
  /** Re-fetch myAgents (primary + members) — gọi sau khi setPrimary / addMember. */
  refreshMyAgents: () => Promise<void>;
  /** Set primary agent (UI Topbar + Settings → đồng bộ về server). */
  setPrimary: (agentId: string | null) => Promise<void>;
}

/** Đặt user + nạp dữ liệu low-code + nạp membership. */
function enter(set: (p: Partial<AuthState>) => void, get: () => AuthState, user: AuthUser): void {
  set({ status: "in", user, error: "", errorCode: null });
  void useUserObjects.getState().hydrate();
  // Không block UI — fire-and-forget membership.
  void get().refreshMyAgents();
}

/** Trích `{ message, code }` từ TRPCClientError (hoặc Error thuần).
   Server trả TRPCError → @trpc/client gắn `.data.code`. Fallback "INTERNAL". */
function extractTrpcError(e: unknown): { message: string; code: string } {
  const err = e as { message?: string; data?: { code?: string } };
  return {
    message: err?.message ?? String(e),
    code: err?.data?.code ?? "INTERNAL_SERVER_ERROR",
  };
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: "checking",
  user: null,
  registrationOpen: null,
  error: "",
  errorCode: null,
  primaryAgentId: null,
  myAgentRoles: {},

  check: async () => {
    // Trạng thái đăng ký (mở khi chưa có admin) — độc lập phiên, chạy song song.
    void auth
      .registrationOpen()
      .then((r) => set({ registrationOpen: r.open }))
      .catch(() => {
        /* server cũ / lỗi mạng — giữ null, UI mặc định ẩn đăng ký */
      });
    try {
      const u = (await auth.me()) as AuthUser;
      enter(set, get, u);
    } catch {
      set({ status: "out", user: null, primaryAgentId: null, myAgentRoles: {} });
    }
  },

  login: async (email, password) => {
    try {
      const u = (await auth.login(email, password)) as AuthUser;
      enter(set, get, u);
    } catch (e) {
      const { message, code } = extractTrpcError(e);
      set({ error: message || t("auth.login_failed"), errorCode: code });
    }
  },

  register: async (email, name, password) => {
    try {
      await auth.register(email, name, password);
      // register không tạo phiên — đăng nhập ngay để lấy cookie.
      const u = (await auth.login(email, password)) as AuthUser;
      enter(set, get, u);
    } catch (e) {
      const { message, code } = extractTrpcError(e);
      set({ error: message || t("auth.register_failed"), errorCode: code });
    }
  },

  logout: async () => {
    try {
      await auth.logout();
    } catch {
      /* ignore */
    }
    // Dong WS dung chung — tranh socket cu (phien cu) con song khi user khac
    // dang nhap lai cung tab. Reconnect se dung cookie phien moi.
    closeRealtime();
    set({ status: "out", user: null, primaryAgentId: null, myAgentRoles: {} });
  },

  clearError: () => set({ error: "", errorCode: null }),

  refreshMyAgents: async () => {
    try {
      const r = await api.agents.myAgents();
      const roles: Record<string, AgentMemberRole> = {};
      for (const m of r.members) roles[m.agentId] = m.role as AgentMemberRole;
      set({ primaryAgentId: r.primaryAgentId, myAgentRoles: roles });
    } catch {
      // Server cũ (chưa migrate) hoặc lỗi mạng — giữ giá trị cũ.
    }
  },

  setPrimary: async (agentId) => {
    // Optimistic: cập nhật trước, rollback nếu lỗi.
    const prev = get().primaryAgentId;
    set({ primaryAgentId: agentId });
    try {
      await api.agents.setPrimary(agentId);
    } catch (e) {
      set({ primaryAgentId: prev });
      throw e;
    }
  },
}));
