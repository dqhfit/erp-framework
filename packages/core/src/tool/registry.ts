/* ==========================================================
   registry.ts — ToolRegistry: bản ghi runtime in-memory của
   các tool đã discover/enable. Singleton toàn cục, song song
   với pluginRegistry — không kế thừa. Persistence thực ở
   bảng `tools` + `company_tools`; registry chỉ là cache.
   ========================================================== */
import type {
  RegisteredTool, ToolManifest, ToolSource, ToolStatus,
} from "./types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  /** Đăng ký / cập nhật một tool (idempotent theo id). */
  register(manifest: ToolManifest, source: ToolSource): RegisteredTool {
    const prev = this.tools.get(manifest.id);
    const entry: RegisteredTool = {
      id: manifest.id,
      manifest,
      source,
      status: prev?.status ?? "validated",
      runtimeMeta: prev?.runtimeMeta,
      error: undefined,
    };
    this.tools.set(manifest.id, entry);
    return entry;
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  getById(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  remove(id: string): void {
    this.tools.delete(id);
  }

  setStatus(
    id: string,
    status: ToolStatus,
    meta?: Partial<RegisteredTool["runtimeMeta"]>,
    error?: string,
  ): void {
    const t = this.tools.get(id);
    if (!t) return;
    t.status = status;
    if (meta) t.runtimeMeta = { ...t.runtimeMeta, ...meta };
    t.error = error;
  }

  /** Trả danh sách id để debug / log. */
  ids(): string[] { return [...this.tools.keys()]; }

  clear(): void { this.tools.clear(); }
}

/** Singleton toàn cục — dùng giống pluginRegistry. */
export const toolRegistry = new ToolRegistry();
