/* ==========================================================
   Tool SDK — hợp đồng cho "Tool": artifact NGOÀI monorepo
   (vd D:\code\cowok\Tools\*) được ERP discover, mount,
   spawn hoặc proxy. Khác plugin (in-process TS module) ở
   chỗ tool là artifact độc lập, vòng đời do registry quản.
   Core chỉ chứa TYPE thuần — validation zod + I/O sống ở
   packages/server/src/tools/.
   ========================================================== */

/** Loại "kind" của tool — quyết định adapter chạy thế nào. */
export type ToolKind = "web-app" | "mcp-server" | "cli" | "plugin";

/** Cách mount/run tool. */
export type ToolRuntime = "embedded" | "spawn" | "remote";

/** Trạng thái vòng đời (in-memory registry). */
export type ToolStatus =
  | "discovered"  // đã đọc manifest, chưa validate xong
  | "validated"   // schema ok
  | "enabled"     // có ít nhất 1 company bật, hoặc enabledGlobal
  | "running"     // spawn runtime đang sống
  | "mounted"     // embedded/remote — proxy đã wire
  | "error";      // validate hoặc spawn fail

/** Khai báo I/O của 1 tool (lỏng, theo paperclip.manifest.json). */
export interface ToolIODef {
  name: string;
  type: string;             // "string" | "number" | "object" | "file" | "array" | "boolean"
  required?: boolean;
  mediaType?: string;
  description?: string;
  /** schema con free-form (paperclip dùng vd {L:"number", W:"number"}). */
  schema?: Record<string, unknown>;
}

/** Khai báo 1 action mà tool expose. */
export interface ToolActionDef {
  name: string;
  description?: string;
  inputs?: ToolIODef[];
  outputs?: ToolIODef[];
}

/** Phần khai báo của paperclip.manifest.json — passthrough, optional fields. */
export interface PaperclipManifestRaw {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  category?: string;
  author?: string;
  type: ToolKind;              // paperclip dùng "type" cho kind
  entry: string;
  runtime?: string;            // "browser" | "node" (paperclip semantic — convert sang ToolRuntime)
  inputs?: ToolIODef[];
  outputs?: ToolIODef[];
  actions?: ToolActionDef[];
  integrations?: Record<string, unknown>;
  permissions?: string[];
  dependencies?: Record<string, unknown>;
  tags?: string[];
  icon?: string;
}

/** Phần override của erp.tool.json — chỉ ERP hiểu. */
export interface ErpToolOverride {
  /** Slug bền vững (mặc định = manifest.name). */
  id?: string;
  runtime?: ToolRuntime;
  enabled?: boolean;
  /** Khi runtime=remote: URL gốc đã chạy sẵn. */
  remoteUrl?: string;
  /** Khi runtime=spawn: cấu hình child process. */
  spawn?: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** Nếu null → cấp ephemeral port qua net.createServer().listen(0). */
    port?: number;
    /** Endpoint trả 2xx khi tool sẵn sàng. */
    healthPath?: string;
    /** Auto-start sau scan? Mặc định false. */
    autoStart?: boolean;
  };
  /** Cấu hình HTTP proxy (web-app). */
  proxy?: {
    /** Mặc định "/tools/<slug>". */
    mountPath?: string;
    /** Có inject X-ERP-* HMAC headers không? Mặc định true. */
    forwardAuth?: boolean;
  };
  /** kind=mcp-server: tên row mcpConfigs auto-tạo (mặc định "tool:"+slug). */
  mcpConfigName?: string;
  /** kind=plugin: path .js/.mjs relative tới tool root để dynamic import. */
  pluginEntry?: string;
  /** Override permissions[] (vd cấm network). */
  permissions?: string[];
}

/** Manifest đã merge + chuẩn hoá — dạng nội bộ. */
export interface ToolManifest {
  /** Slug bền — duy nhất toàn hệ thống. */
  id: string;
  /** Bản gốc từ paperclip.manifest.json (truy cập field gốc khi cần). */
  raw: PaperclipManifestRaw;
  name: string;
  version: string;
  displayName: string;
  description?: string;
  category?: string;
  icon?: string;
  kind: ToolKind;
  runtime: ToolRuntime;
  entry: string;
  inputs: ToolIODef[];
  outputs: ToolIODef[];
  actions: ToolActionDef[];
  permissions: string[];
  tags: string[];
  spawn?: ErpToolOverride["spawn"];
  proxy?: ErpToolOverride["proxy"];
  remoteUrl?: string;
  mcpConfigName?: string;
  pluginEntry?: string;
}

/** Nơi tool được phát hiện. */
export type ToolSource =
  | { kind: "local"; path: string; overridePath?: string }
  | { kind: "remote"; manifestUrl: string };

/** Bản ghi runtime trong registry. */
export interface RegisteredTool {
  id: string;
  manifest: ToolManifest;
  source: ToolSource;
  status: ToolStatus;
  error?: string;
  runtimeMeta?: {
    pid?: number;
    port?: number;
    mountPath?: string;
    startedAt?: Date;
  };
}

/** Phiên bản API tool hiện tại — bump khi sửa hợp đồng manifest. */
export const TOOL_API_VERSION = "0.1.0";
