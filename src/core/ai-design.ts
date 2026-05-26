/* ==========================================================
   ai-design.ts — Service gọi LLM đề xuất config cho design
   object (entity/page/workflow/agent). Parse JSON từ response.
   ========================================================== */

import { llmRegistry } from "@/core/llm/registry";
import {
  buildUserMessage,
  type DesignByType,
  type DesignContext,
  type DesignObjectType,
  type DesignRequest,
  SYSTEM_PROMPTS,
} from "@/lib/ai-design-prompts";

export interface AiDesignCallOptions {
  /** Tên profile LLM trong registry. Nếu thiếu, dùng profile đầu tiên. */
  profileName?: string;
}

export interface AiDesignResult<T> {
  /** Config parse được */
  data: T;
  /** Raw text từ LLM (cho debug / hiển thị chat) */
  raw: string;
  /** Profile đã dùng */
  profileName: string;
  /** Token usage */
  usage: { input_tokens: number; output_tokens: number };
}

/** ============= JSON extractor =============
 * LLM thường trả response như:
 *   ```json
 *   { ... }
 *   ```
 * Hoặc đôi khi không có code block. Hàm này robust với cả 2.
 */
export function extractJson(text: string): string {
  // Ưu tiên ```json ... ``` hoặc ``` ... ```
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced?.[1]) return fenced[1].trim();

  // Fallback: tìm { ... } cấp ngoài cùng — balance
  const start = text.indexOf("{");
  if (start === -1) return text.trim();
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start).trim();
}

/** ============= Validate cấp 1 =============
 * Đảm bảo response có đúng key tối thiểu cho từng type.
 */
function validateShape<T>(type: DesignObjectType, data: unknown): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM trả về không phải object JSON");
  }
  const obj = data as Record<string, unknown>;

  const required: Record<DesignObjectType, string[]> = {
    entity: ["name", "fields"],
    page: ["name", "components"],
    workflow: ["name", "nodes"],
    agent: ["name", "model", "systemPrompt"],
  };

  for (const k of required[type]) {
    if (!(k in obj)) throw new Error(`Thiếu field bắt buộc "${k}" trong response`);
  }

  // Sanity cho mảng
  if (type === "entity" && !Array.isArray(obj.fields)) {
    throw new Error("entity.fields phải là array");
  }
  if (type === "page" && !Array.isArray(obj.components)) {
    throw new Error("page.components phải là array");
  }
  if (type === "workflow") {
    if (!Array.isArray(obj.nodes)) throw new Error("workflow.nodes phải là array");
    if (obj.edges !== undefined && !Array.isArray(obj.edges)) {
      throw new Error("workflow.edges phải là array");
    }
  }

  return data as T;
}

/** ============= Chọn profile mặc định =============
 */
function pickProfileName(explicit?: string): string {
  if (explicit) return explicit;
  const profiles = llmRegistry.listUsableProfiles();
  if (!profiles.length) {
    throw new Error(
      "Chưa có LLM profile khả dụng — vào Settings → LLM Profiles để tạo (cần API key hoặc bridge).",
    );
  }
  // profiles.length đã kiểm tra > 0 ở trên — first element không thể vắng.
  const first = profiles[0];
  if (!first) throw new Error("LLM profile vắng bất ngờ.");
  return first.name;
}

/** ============= Main entry =============
 * Gọi LLM, parse + validate.
 */
export async function designWithAi<T extends DesignObjectType>(
  type: T,
  request: DesignRequest,
  context: DesignContext = {},
  options: AiDesignCallOptions = {},
): Promise<AiDesignResult<DesignByType<T>>> {
  const profileName = pickProfileName(options.profileName);

  const userMessage = buildUserMessage(type, request, context);

  const res = await llmRegistry.send(profileName, {
    system: SYSTEM_PROMPTS[type],
    messages: [{ role: "user", content: userMessage }],
    response_format: "json",
    temperature: 0.2,
    max_tokens: 4096,
  });

  // Parse
  let parsed: unknown;
  const jsonText = extractJson(res.text);
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `LLM trả JSON không hợp lệ: ${(e as Error).message}\n---raw---\n${res.text.slice(0, 500)}`,
    );
  }

  // Validate
  const data = validateShape<DesignByType<T>>(type, parsed);

  return {
    data,
    raw: res.text,
    profileName,
    usage: res.usage,
  };
}

/** ============= Helper cho UI: list profile name =============
 */
export function listLlmProfileNames(): string[] {
  // Chỉ list profile khả dụng (có key HOẶC dùng adapter no-key)
  return llmRegistry.listUsableProfiles().map((p) => p.name);
}
