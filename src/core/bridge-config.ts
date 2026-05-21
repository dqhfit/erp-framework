/* ==========================================================
   bridge-config.ts — Save/load config qua Claude bridge server
   Endpoint: http://localhost:8909/config/:key
   ========================================================== */

const DEFAULT_URL = "http://localhost:8909";

function bridgeUrl(): string {
  return localStorage.getItem("claude-cli-bridge-url") || DEFAULT_URL;
}

export interface BridgeStatus {
  online: boolean;
  configDir?: string;
}

export async function checkBridge(url?: string): Promise<BridgeStatus> {
  const base = (url || bridgeUrl()).replace(/\/$/, "");
  try {
    const res = await fetch(base + "/health", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { online: false };
    const data = await res.json() as { ok: boolean; configDir?: string };
    return { online: !!data.ok, configDir: data.configDir };
  } catch {
    return { online: false };
  }
}

export async function loadConfig<T>(key: string): Promise<T | null> {
  const base = bridgeUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/config/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(3000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Load config '${key}' failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function saveConfig<T>(key: string, data: T): Promise<{ ok: boolean; savedAt: string }> {
  const base = bridgeUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/config/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Save config '${key}' failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ ok: boolean; savedAt: string }>;
}

export async function deleteConfig(key: string): Promise<void> {
  const base = bridgeUrl().replace(/\/$/, "");
  await fetch(`${base}/config/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function listConfigs(): Promise<string[]> {
  const base = bridgeUrl().replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/configs`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json() as { keys: string[] };
    return data.keys ?? [];
  } catch {
    return [];
  }
}
