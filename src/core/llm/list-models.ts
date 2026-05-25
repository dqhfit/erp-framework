/* ==========================================================
   list-models.ts — Fetch danh sách model động cho từng adapter.
   - Cache 30 phút trong localStorage (key llm-models-cache:<adapter>)
   - Fallback về hardcoded list nếu API lỗi hoặc thiếu credential.
   - Tất cả browser-direct (cần CORS hoặc dangerous-direct-browser-access).
   ========================================================== */

// ============= Fallback list (khi API lỗi) =============
export const FALLBACK_MODELS: Record<string, string[]> = {
  claude: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "claude-pro": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "claude-cli": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3"],
  gemini: ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-flash"],
  ollama: ["llama3", "llama3:70b", "mistral", "qwen2.5"],
};

const CACHE_KEY = (adapter: string, endpoint = "") =>
  `llm-models-cache:${adapter}:${endpoint || "default"}`;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

interface CachedModels {
  at: number;
  models: string[];
}

export interface ListModelsOptions {
  apiKey?: string;
  endpoint?: string;
  /** Bỏ qua cache, ép fetch mới */
  force?: boolean;
}

export interface ListModelsResult {
  models: string[];
  source: "cache" | "api" | "fallback";
  error?: string;
}

// ============= Public API =============

export async function listModels(
  adapter: string,
  opts: ListModelsOptions = {},
): Promise<ListModelsResult> {
  const cacheKey = CACHE_KEY(adapter, opts.endpoint);

  // Cache hit
  if (!opts.force) {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as CachedModels;
        if (Date.now() - cached.at < CACHE_TTL && cached.models.length) {
          return { models: cached.models, source: "cache" };
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Fetch
  try {
    const models = await fetchModels(adapter, opts);
    if (models.length) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), models } as CachedModels));
      } catch {
        /* ignore quota */
      }
      return { models, source: "api" };
    }
    return { models: FALLBACK_MODELS[adapter] ?? [], source: "fallback", error: "API trả 0 model" };
  } catch (e) {
    return {
      models: FALLBACK_MODELS[adapter] ?? [],
      source: "fallback",
      error: (e as Error).message,
    };
  }
}

export function clearModelCache(adapter?: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k?.startsWith("llm-models-cache:") &&
        (!adapter || k.startsWith(`llm-models-cache:${adapter}:`))
      ) {
        keys.push(k);
      }
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// ============= Per-adapter fetcher =============

async function fetchModels(adapter: string, opts: ListModelsOptions): Promise<string[]> {
  switch (adapter) {
    case "claude":
      return fetchAnthropicModels(opts.apiKey);
    case "claude-pro":
      return fetchAnthropicOAuthModels();
    case "claude-cli":
      return fetchBridgeModels(opts.endpoint, opts.force);
    case "openai":
      return fetchOpenAiModels(opts.apiKey, opts.endpoint);
    case "gemini":
      return fetchGeminiModels(opts.apiKey);
    case "ollama":
      return fetchOllamaModels(opts.endpoint);
    default:
      return [];
  }
}

async function fetchAnthropicModels(apiKey: string | undefined): Promise<string[]> {
  if (!apiKey) throw new Error("Cần API key để list model");
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id);
}

async function fetchAnthropicOAuthModels(): Promise<string[]> {
  const { getAccessToken } = await import("./oauth");
  const token = await getAccessToken();
  if (!token) throw new Error("Chưa đăng nhập Claude Pro");
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) throw new Error(`Anthropic OAuth ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id);
}

async function fetchBridgeModels(endpoint: string | undefined, force = false): Promise<string[]> {
  const base = (endpoint || "http://localhost:8909").replace(/\/$/, "");
  const url = force ? `${base}/models?refresh=1` : `${base}/models`;
  // CLI có thể mất ~5-10s nếu phải hỏi LLM, nên timeout rộng hơn
  const res = await fetch(url, { signal: AbortSignal.timeout(force ? 30000 : 5000) });
  if (!res.ok) throw new Error(`Bridge ${res.status}`);
  const data = (await res.json()) as { models?: string[]; source?: string };
  return data.models ?? [];
}

async function fetchOpenAiModels(
  apiKey: string | undefined,
  endpoint: string | undefined,
): Promise<string[]> {
  if (!apiKey) throw new Error("Cần API key để list model");
  const base = (endpoint || "https://api.openai.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  // Lọc chỉ model chat (gpt-*, o*, chatgpt-*) cho ngắn list
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o[1-9]|chatgpt)/i.test(id))
    .sort();
}

async function fetchGeminiModels(apiKey: string | undefined): Promise<string[]> {
  if (!apiKey) throw new Error("Cần API key để list model");
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

async function fetchOllamaModels(endpoint: string | undefined): Promise<string[]> {
  const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}
