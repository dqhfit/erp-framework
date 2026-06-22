/* ==========================================================
   web-search.ts — Tìm kiếm web qua SearXNG (sidecar nội bộ
   hoặc cấu hình riêng theo công ty).

   Thứ tự ưu tiên cấu hình:
     1. Bảng company_integration_secrets (provider='searxng') — per-company
     2. Biến môi trường SEARXNG_URL — mặc định toàn deployment
     3. http://127.0.0.1:8080 — địa chỉ mặc định SearXNG local

   SearXNG là sidecar tin cậy (giống Ollama/Tika) — gọi trực tiếp
   bằng fetch + splitUrlAuth(). KHÔNG dùng defaultRunHttp (chặn IP nội bộ).
   Lỗi mạng / chưa cấu hình → ném Error rõ ràng tiếng Việt.
   ========================================================== */

import { companyIntegrationSecrets } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import { logActivity } from "./activity";
import { decryptSecret } from "./crypto";
import type { DB } from "./db";
import { splitUrlAuth } from "./url-auth";

/* ─── Types công khai ─────────────────────────────────────── */

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface SearchConfig {
  baseUrl: string;
  configured: boolean;
  source: "company" | "env" | "default";
}

/* ─── Phân giải cấu hình SearXNG theo company ────────────── */

export async function resolveSearchConfig(db: DB, companyId: string): Promise<SearchConfig> {
  // 1. Ưu tiên cấu hình per-company
  const [row] = await db
    .select()
    .from(companyIntegrationSecrets)
    .where(
      and(
        eq(companyIntegrationSecrets.companyId, companyId),
        eq(companyIntegrationSecrets.provider, "searxng"),
      ),
    )
    .limit(1);

  if (row) {
    const baseUrl = decryptSecret(row.secretEnc);
    return { baseUrl, configured: true, source: "company" };
  }

  // 2. Biến môi trường SEARXNG_URL
  if (process.env.SEARXNG_URL) {
    return { baseUrl: process.env.SEARXNG_URL, configured: true, source: "env" };
  }

  // 3. Mặc định local — 127.0.0.1 thay vì localhost để né bug Node IPv6 ::1
  return { baseUrl: "http://127.0.0.1:8080", configured: false, source: "default" };
}

/* ─── Gọi SearXNG API (dùng chung bởi webSearch + test raw) ─ */

interface SearXNGResult {
  title?: string;
  url?: string;
  content?: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
}

/** Kiểm tra URL SearXNG ở mức tối thiểu: chỉ cho phép http/https (chặn
 *  file:/gopher:/... ). CỐ Ý KHÔNG chặn IP nội bộ/loopback: SearXNG là
 *  sidecar nội bộ tin cậy (vd searxng:8080, 127.0.0.1:8080) — cùng trust
 *  model với Ollama/Tika; endpoint do admin cấu hình (rbac edit settings),
 *  không phải input người dùng thường. Chặn private IP sẽ phá chính tính năng,
 *  nên KHÔNG route qua defaultRunHttp (hàm đó chặn IP nội bộ). */
function assertHttpUrl(baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error("URL SearXNG không hợp lệ");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Scheme không hỗ trợ (chỉ http/https): ${u.protocol}`);
  }
}

/** Gọi SearXNG với baseUrl đã biết (không tra DB). Dùng cho test trực tiếp. */
export async function webSearchRaw(
  baseUrl: string,
  query: string,
  opts?: { limit?: number; categories?: string },
): Promise<WebSearchResult[]> {
  assertHttpUrl(baseUrl);
  const { url: base, headers: auth } = splitUrlAuth(baseUrl);

  const params = new URLSearchParams({
    q: query,
    format: "json",
    safesearch: "1",
    language: "vi",
  });
  if (opts?.categories) {
    params.set("categories", opts.categories);
  }

  let res: Response;
  try {
    // redirect:"manual" — KHÔNG tự theo Location (giảm bề mặt SSRF: endpoint
    // bị chiếm/độc không pivot server sang host nội bộ khác qua redirect).
    res = await fetch(`${base}/search?${params.toString()}`, {
      headers: { ...auth },
      redirect: "manual",
    });
  } catch (err) {
    throw new Error(`Không gọi được SearXNG (${base}): ${(err as Error).message}`);
  }

  // 3xx → coi là lỗi cấu hình, không theo redirect.
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`SearXNG trả redirect ${res.status} — kiểm tra lại URL`);
  }
  if (!res.ok) {
    // KHÔNG echo body upstream (tránh lộ nội dung nội bộ qua blind SSRF).
    throw new Error(`SearXNG trả lỗi ${res.status}`);
  }

  const json = (await res.json()) as SearXNGResponse;
  const limit = opts?.limit ?? 5;
  const raw = json.results ?? [];

  return raw.slice(0, limit).map((r, idx) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
    // Score giảm dần theo thứ hạng: 1/(idx+1)
    score: 1 / (idx + 1),
  }));
}

/* ─── Hàm chính: tìm kiếm web theo company ───────────────── */

export async function webSearch(
  db: DB,
  companyId: string,
  query: string,
  opts?: { limit?: number; categories?: string },
): Promise<WebSearchResult[]> {
  const cfg = await resolveSearchConfig(db, companyId);
  const results = await webSearchRaw(cfg.baseUrl, query, opts);

  // Ghi nhật ký hoạt động — lỗi log không vỡ kết quả trả về
  try {
    await logActivity(db, {
      companyId,
      kind: "web_search",
      objectType: "knowledge",
      detail: `Tìm web: "${query}" (${results.length} kết quả)`,
    });
  } catch {
    // Bỏ qua lỗi logActivity — fail-safe
  }

  return results;
}
