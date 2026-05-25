import { useSettings } from "@/stores/settings";
/* ==========================================================
   LLM Registry — facade quanh adapters + profile store.
   - Adapters: in-memory Map (register lúc import index.ts)
   - Profiles: ĐỌC THẲNG từ Zustand useSettings — single source
     of truth, không còn 2 nơi lưu profile bị lệch nhau.
   ========================================================== */
import type { LLMAdapter, LLMProfile, LLMRequest, LLMResponse } from "@/types/llm";

// Adapter mà không cần API key (OAuth / local bridge / local model)
const NO_KEY_ADAPTERS = new Set(["claude-pro", "claude-cli", "ollama"]);

class LLMRegistry {
  private adapters = new Map<string, LLMAdapter>();

  // ===== Adapters =====
  register(adapter: LLMAdapter) {
    this.adapters.set(adapter.id, adapter);
  }
  get(id: string) {
    return this.adapters.get(id);
  }
  list() {
    return Array.from(this.adapters.values());
  }

  // ===== Profiles (đọc/ghi qua Zustand) =====
  listProfiles(): LLMProfile[] {
    return Object.values(useSettings.getState().llmProfiles);
  }
  getProfile(name: string): LLMProfile | undefined {
    return useSettings.getState().llmProfiles[name];
  }
  setProfile(profile: LLMProfile) {
    useSettings.getState().setLlmProfile(profile);
  }
  deleteProfile(name: string) {
    useSettings.getState().deleteLlmProfile(name);
  }

  /** Profile có đủ credential để gọi (có key hoặc dùng adapter no-key). */
  isUsable(profile: LLMProfile): boolean {
    if (NO_KEY_ADAPTERS.has(profile.adapter)) return true;
    return !!profile.apiKey;
  }
  listUsableProfiles(): LLMProfile[] {
    return this.listProfiles().filter((p) => this.isUsable(p));
  }

  async send(profileName: string, req: LLMRequest): Promise<LLMResponse> {
    const profile = this.getProfile(profileName);
    if (!profile) throw new Error(`Profile không tồn tại: ${profileName}`);
    const adapter = this.adapters.get(profile.adapter);
    if (!adapter) throw new Error(`Adapter không tồn tại: ${profile.adapter}`);
    return adapter.send({
      model: profile.model,
      apiKey: profile.apiKey,
      endpoint: profile.endpoint,
      temperature: profile.temperature ?? 0.7,
      max_tokens: profile.max_tokens ?? 4_096,
      ...req,
    });
  }
}

export const llmRegistry = new LLMRegistry();
