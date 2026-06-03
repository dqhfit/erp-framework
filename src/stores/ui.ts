import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentColor = "violet" | "cyan" | "green" | "amber";
export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type Mode = "designer" | "consumer";
export type AiCreateTarget = "entity" | "page" | "workflow" | "agent" | null;
/** Cách hiển thị tên trường trong các designer: tên cột (name) hay nhãn (label). */
export type FieldDisplayMode = "name" | "label";

export interface AgentObjectContext {
  type: "entity" | "workflow" | "page" | "agent";
  id: string;
  label: string;
}

interface UIState {
  theme: Theme;
  accent: AccentColor;
  density: Density;
  sidebarCollapsed: boolean;
  inspectorVisible: boolean;
  mode: Mode;
  /** Tuỳ chọn TOÀN CỤC: hiển thị trường theo tên cột hay nhãn (Nguồn dữ liệu/Trang/Workflow). */
  fieldDisplayMode: FieldDisplayMode;
  agentOpen: boolean;
  cmdOpen: boolean;
  tweaksOpen: boolean;
  /** Sidebar off-canvas đang mở trên mobile (<768px). Session-only,
     không persist — tách khỏi sidebarCollapsed (trạng thái 56/240 desktop). */
  mobileNavOpen: boolean;
  aiCreateTarget: AiCreateTarget;
  /** Context đối tượng đang được xem — route set, AgentPanel đọc. Không persist. */
  agentContext: AgentObjectContext | null;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentColor) => void;
  setDensity: (d: Density) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setInspectorVisible: (v: boolean) => void;
  setMode: (m: Mode) => void;
  setFieldDisplayMode: (m: FieldDisplayMode) => void;
  setAgentOpen: (v: boolean) => void;
  setCmdOpen: (v: boolean) => void;
  setTweaksOpen: (v: boolean) => void;
  setMobileNavOpen: (v: boolean) => void;
  setAiCreateTarget: (t: AiCreateTarget) => void;
  setAgentContext: (ctx: AgentObjectContext | null) => void;
}

const TYPE_LABEL: Record<AgentObjectContext["type"], string> = {
  entity: "Entity",
  workflow: "Workflow",
  page: "Trang",
  agent: "Agent",
};

export function formatAgentContext(ctx: AgentObjectContext): string {
  return `${TYPE_LABEL[ctx.type]} "${ctx.label}"`;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: "dark",
      accent: "violet",
      density: "comfortable",
      sidebarCollapsed: false,
      inspectorVisible: true,
      mode: "designer",
      fieldDisplayMode: "name",
      agentOpen: false,
      cmdOpen: false,
      tweaksOpen: false,
      mobileNavOpen: false,
      aiCreateTarget: null,
      agentContext: null,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setInspectorVisible: (inspectorVisible) => set({ inspectorVisible }),
      setMode: (mode) => set({ mode }),
      setFieldDisplayMode: (fieldDisplayMode) => set({ fieldDisplayMode }),
      setAgentOpen: (agentOpen) => set({ agentOpen }),
      setCmdOpen: (cmdOpen) => set({ cmdOpen }),
      setTweaksOpen: (tweaksOpen) => set({ tweaksOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setAiCreateTarget: (aiCreateTarget) => set({ aiCreateTarget }),
      setAgentContext: (agentContext) => set({ agentContext }),
    }),
    {
      name: "erp-ui",
      partialize: (s) => ({
        theme: s.theme,
        accent: s.accent,
        density: s.density,
        sidebarCollapsed: s.sidebarCollapsed,
        inspectorVisible: s.inspectorVisible,
        mode: s.mode,
        fieldDisplayMode: s.fieldDisplayMode,
        agentOpen: s.agentOpen,
        cmdOpen: s.cmdOpen,
        tweaksOpen: s.tweaksOpen,
        aiCreateTarget: s.aiCreateTarget,
        // agentContext: session-only, không persist
      }),
    },
  ),
);
