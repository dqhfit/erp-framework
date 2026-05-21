import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentColor = "violet" | "cyan" | "green" | "amber";
export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type Mode = "designer" | "consumer";
export type AiCreateTarget = "entity" | "page" | "workflow" | "agent" | null;

interface UIState {
  theme: Theme;
  accent: AccentColor;
  density: Density;
  sidebarCollapsed: boolean;
  inspectorVisible: boolean;
  mode: Mode;
  agentOpen: boolean;
  cmdOpen: boolean;
  tweaksOpen: boolean;
  aiCreateTarget: AiCreateTarget;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentColor) => void;
  setDensity: (d: Density) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setInspectorVisible: (v: boolean) => void;
  setMode: (m: Mode) => void;
  setAgentOpen: (v: boolean) => void;
  setCmdOpen: (v: boolean) => void;
  setTweaksOpen: (v: boolean) => void;
  setAiCreateTarget: (t: AiCreateTarget) => void;
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
      agentOpen: false,
      cmdOpen: false,
      tweaksOpen: false,
      aiCreateTarget: null,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setInspectorVisible: (inspectorVisible) => set({ inspectorVisible }),
      setMode: (mode) => set({ mode }),
      setAgentOpen: (agentOpen) => set({ agentOpen }),
      setCmdOpen: (cmdOpen) => set({ cmdOpen }),
      setTweaksOpen: (tweaksOpen) => set({ tweaksOpen }),
      setAiCreateTarget: (aiCreateTarget) => set({ aiCreateTarget }),
    }),
    { name: "erp-ui" },
  ),
);
