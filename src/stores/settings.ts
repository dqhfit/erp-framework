import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { McpConfig } from "@/core/mcp";
import type { LLMProfile } from "@/types/llm";

interface SettingsState {
  mcp: McpConfig;
  llmProfiles: Record<string, LLMProfile>;
  setMcp: (cfg: McpConfig) => void;
  setLlmProfile: (p: LLMProfile) => void;
  deleteLlmProfile: (name: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      mcp: { mode: "demo" },
      llmProfiles: {},
      setMcp: (cfg) => set({ mcp: cfg }),
      setLlmProfile: (p) => set((s) => ({ llmProfiles: { ...s.llmProfiles, [p.name]: p } })),
      deleteLlmProfile: (name) => set((s) => {
        const { [name]: _, ...rest } = s.llmProfiles;
        return { llmProfiles: rest };
      }),
    }),
    { name: "erp-settings" },
  ),
);
