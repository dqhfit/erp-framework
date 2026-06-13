/* ==========================================================
   mcp-migration.ts — MCP server (JSON-RPC over HTTP) cho module Migration.

   Mục tiêu: cho AI kết nối, đọc trạng thái đồng bộ DQHF→ERP (delta-sync
   + full-import) và schema entity (storage tier, field mapping) để phân
   tích, phát hiện lỗi, gợi ý tối ưu. Tool ghi giới hạn ở thao tác AN TOÀN
   + idempotent (bật agentSearchable, rename bảng promote) — KHÔNG có tool
   import/promote/delete data.

   Endpoint: POST /mcp/migration   (JSON-RPC 2.0)
   Auth:     header X-API-Key (api_keys), scope:
     - migration:read   → tool đọc
     - migration:apply  → tool ghi (kèm quyền đọc)
     - "*" / "migration:*" → toàn quyền migration
   Deny-by-default: scope rỗng = không gì.
   ========================================================== */
import {
  dataSources,
  entities,
  migrationFullJobs,
  migrationFullJobTables,
  migrationSyncModules,
  migrationSyncRuns,
  migrationSyncTables,
  mssqlConnections,
  pages,
} from "@erp-framework/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authApiKey } from "./api-key-auth";
import { resolveList } from "./datasource-resolver";
import { dsConfig as dataSourceConfigSchema } from "./datasources-router";
import type { DB } from "./db";
import { dropTableForEntity, renamePromotedTablesForCompany } from "./entity-promote";
import { assertIdent, type EntityStorage, syncEntityTableSchema } from "./entity-table-ddl";
import { enableModuleSyncForCompany } from "./migration-delta-sync";
import { createFullImportJob, type FullJobItem } from "./migration-full-import";
import { enqueueMigrationJob } from "./migration-worker";
import { getModuleProc, getModuleProcByName } from "./module-procs";
import { isHybridTablesEnabled } from "./record-store";

/* ── Scope helper ───────────────────────────────────────────── */
export function hasMigrationScope(scopes: string[], level: "read" | "apply" = "read"): boolean {
  if (scopes.includes("*") || scopes.includes("migration:*")) return true;
  // apply = thao tác ghi (bật agentSearchable, rename bảng) — chỉ migration:apply.
  if (level === "apply") return scopes.includes("migration:apply");
  // read = apply bao luôn read.
  return scopes.includes("migration:read") || scopes.includes("migration:apply");
}

/* ── Lỗi tool ───────────────────────────────────────────────── */
class McpError extends Error {
  code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.code = code;
  }
}

/* ── Tool definitions ───────────────────────────────────────── */
interface ToolDef {
  name: string;
  description: string;
  level: "read" | "apply";
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "migration_list_modules",
    description:
      "Liệt kê các module delta-sync (MSSQL→PG) của công ty. Trả: module name, enabled, " +
      "heartbeatAt (null=không có job đang chạy), createdAt. Dùng để xem module nào đang " +
      "hoạt động, module nào bị kẹt (heartbeat stale > 10 phút).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Lọc theo trạng thái bật/tắt (bỏ qua = lấy hết)",
        },
      },
    },
  },
  {
    name: "migration_get_module",
    description:
      "Lấy chi tiết 1 module delta-sync: danh sách bảng (tableName, mode, status, " +
      "pendingChanges, ctLastVersion, insertsCount, updatesCount, deletesCount, " +
      "lastSyncedAt, lastError). Dùng để chẩn đoán bảng bị lỗi hoặc lag cao.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Tên module, vd 'mes_dinhmuc'" },
      },
      required: ["module"],
    },
  },
  {
    name: "migration_list_runs",
    description:
      "Lịch sử các lần sync gần nhất của 1 module (mặc định 50 run). " +
      "Trả: module, tableName, startedAt, durationMs, inserts, updates, deletes, error. " +
      "Dùng để xem trend lag, tần suất lỗi, hiệu năng mỗi chu kỳ.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Tên module" },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Số run trả về (mặc định 50)",
        },
      },
      required: ["module"],
    },
  },
  {
    name: "migration_list_full_jobs",
    description:
      "Liệt kê các job full-import (seed dữ liệu ban đầu). Trả: id, status, " +
      "totalTables, completedTables, totalRowsImported, startedAt, completedAt, error. " +
      "Dùng để kiểm tra tiến độ seed trước khi bật delta-sync.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["queued", "running", "completed", "failed", "paused"],
          description: "Lọc theo trạng thái (bỏ qua = lấy hết, sort mới nhất trước)",
        },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "migration_get_full_job",
    description:
      "Chi tiết 1 job full-import kèm tiến độ từng bảng: tableName, entityName, " +
      "rowsImported, status, lastPk, srcCount, tgtCount, reconcile (ok|drift|skip|null), error. " +
      "Dùng để xác định bảng nào bị kẹt hoặc drift sau import.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "UUID job (lấy từ migration_list_full_jobs)" },
      },
      required: ["jobId"],
    },
  },
  {
    name: "entity_list",
    description:
      "Liệt kê entity của công ty cùng metadata migration: tên, label, " +
      "storageTier (eav|table), tableName (nếu là bảng thật), fieldCount, " +
      "agentSearchable, syncState (nếu có module sync gắn). " +
      "Dùng để xem entity nào đã promote thành bảng thật, entity nào đang được sync.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        storageTier: {
          type: "string",
          enum: ["eav", "table"],
          description: "Lọc theo storage tier (bỏ qua = lấy hết)",
        },
      },
    },
  },
  {
    name: "entity_get",
    description:
      "Chi tiết 1 entity: fields (name, type, label, required, indexed), " +
      "meta.storage (tier, tableName), meta.sync (state, module, lastSyncedAt). " +
      "Dùng để kiểm tra field mapping và trạng thái sync của entity cụ thể.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tên kỹ thuật của entity (vd 'dinh_muc_go_van')",
        },
        id: {
          type: "string",
          description: "Hoặc UUID entity (ưu tiên hơn name nếu có cả 2)",
        },
      },
    },
  },
  {
    name: "migration_inspect_table",
    description:
      "Soi schema VẬT LÝ bảng thật PostgreSQL của 1 entity tier=table: cột thực tế từ " +
      "information_schema (column_name, data_type, nullable) + map field→cột trong " +
      "meta.storage.columns + danh sách field ext-tier (nằm trong ext jsonb) + row count. " +
      "Dùng khi port proc Tier D / viết SQL thô để biết CHÍNH XÁC tên cột vật lý " +
      "(cột field có prefix f_, field type ngoài built-in nằm ở ext).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        entityName: {
          type: "string",
          description: "Tên kỹ thuật entity (vd 'tr_order') — phải là entity tier=table",
        },
      },
      required: ["entityName"],
    },
  },
  {
    name: "migration_list_connections",
    description:
      "Liệt kê kết nối MSSQL đã cấu hình: id, name, host, port, database, isDefault. " +
      "Không trả password. Dùng để biết connectionId khi gọi các tool khác.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "entity_set_agent_searchable",
    description:
      "BẬT/TẮT cho phép agent AI tra cứu entity qua tool records_search " +
      "(meta.agentSearchable, deny-by-default). Truyền danh sách tên entity + enabled. " +
      "Trả kết quả từng entity (ok | not_found).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "Tên kỹ thuật các entity (vd ['san_pham_ab9208'])",
        },
        enabled: { type: "boolean", description: "true = cho agent tra cứu" },
      },
      required: ["names", "enabled"],
    },
  },
  {
    name: "migration_rename_promoted_tables",
    description:
      "Đổi tên các bảng thật đã promote (er_<hash>) sang đúng tên bảng DB cũ " +
      "(meta.source.mssqlTable). Idempotent: bỏ qua mục đã đúng tên / trùng tên / " +
      "không có nguồn. Trả danh sách kết quả (renamed | skip | error) từng bảng.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "migration_export_entities",
    description:
      "Xuất TOÀN BỘ entity import từ MSSQL (có meta.source.mssqlTable) kèm label entity + " +
      "label từng field + recordCount — dùng làm BACKUP trước khi xoá và làm items cho " +
      "migration_start_full_import (label giữ nguyên, không cần enrich lại). " +
      "Kèm danh sách entity KHÔNG có nguồn (sẽ được giữ lại khi xoá).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "migration_delete_imported_entities",
    description:
      "XOÁ vĩnh viễn các entity import theo danh sách tên. GUARD mặc định: chỉ xoá entity có " +
      "meta.source.mssqlTable (entity tạo tay bị từ chối — skipped_no_source). " +
      "force=true: bỏ guard nguồn — dùng khi meta.source bị mất do bug ghi-đè meta cũ " +
      "(danh sách vẫn phải tường minh, đã được người dùng duyệt). " +
      "Entity tier=table: DROP bảng thật + dọn locator trước. Cascade xoá entity_records, " +
      "saved_views, templates... Trả kết quả từng entity (deleted | skipped_no_source | not_found).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          maxItems: 200,
          description: "Tên kỹ thuật các entity cần xoá (danh sách đã được duyệt)",
        },
        force: {
          type: "boolean",
          description: "true = cho phép xoá entity KHÔNG có meta.source (mặc định false)",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "entity_rename_to_source",
    description:
      "Đổi entities.name của mọi entity import (có meta.source.mssqlTable) theo TÊN BẢNG NGUỒN " +
      "(bỏ schema 'dbo.', lowercase, sanitize) — vd 'chi_tiet_don_hang_e43806' → 'tr_order_detail'. " +
      "Label tiếng Việt GIỮ NGUYÊN (chỉ đổi định danh máy). Idempotent: đã đúng tên / trùng tên " +
      "entity khác → skip. Tham chiếu nội bộ theo UUID không ảnh hưởng.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "page_create_draft",
    description:
      "Tạo page DRAFT (published=false — chỉ admin/designer thấy, người dùng KHÔNG thấy " +
      "đến khi publish trong PageDesigner). content = mảng PageComponent " +
      "[{id,kind,x,y,w,h,config}] (grid 12 cột). Idempotent: name đã tồn tại → skip " +
      "(không ghi đè page người dùng đã chỉnh). Dùng cho scaffold UI từ form DQHF.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Định danh máy ^[a-z][a-z0-9_]*$" },
        label: { type: "string", description: "Nhãn hiển thị" },
        icon: { type: "string" },
        content: {
          type: "array",
          description: "PageComponent[] — {id,kind,x,y,w,h,config}",
          items: { type: "object" },
        },
        overwrite: {
          type: "boolean",
          description:
            "true = ghi đè nếu page tồn tại VÀ còn draft (published=false). Page đã publish không bao giờ bị đè.",
        },
      },
      required: ["name", "label", "content"],
    },
  },
  {
    name: "page_list",
    description:
      "Liệt kê toàn bộ page của công ty: id, name, label, published, số widget. " +
      "Dùng để rà soát trước khi dọn page cũ.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "page_delete",
    description:
      "XOÁ vĩnh viễn page theo danh sách tên (đã được người dùng duyệt). " +
      "Trả kết quả từng page (deleted | not_found).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          maxItems: 200,
          description: "Tên page cần xoá",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "page_wire_datasource",
    description:
      "Gắn DataSource vào widget page DRAFT: với mỗi widget có config.entity = baseEntityId " +
      "của DataSource, set config.dataSourceId (useWidgetData ưu tiên dataSourceId → render qua " +
      "join server-side) + CHÈN các cột join chọn lọc (addFields) vào config.fields (dedup, giữ " +
      "thứ tự). Chỉ đụng page draft (published=false) — page đã publish bỏ qua. addFields phải là " +
      "key projection hợp lệ của DataSource. dryRun=true (mặc định) trả kế hoạch, không ghi. " +
      "pageNames rỗng = mọi page khớp.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        dataSourceName: { type: "string", description: "Tên DataSource (datasources.name)" },
        addFields: {
          type: "array",
          items: { type: "string" },
          description: "Cột join (key projection DS) CHÈN THÊM vào cuối fields[] (giữ cột cũ)",
        },
        setFields: {
          type: "array",
          items: { type: "string" },
          description:
            "THAY TRỌN fields[] theo đúng thứ tự này (bám layout grid DQHF). Ưu tiên hơn addFields.",
        },
        pageNames: {
          type: "array",
          items: { type: "string" },
          description: "Giới hạn ở các page này (rỗng = mọi page khớp base entity)",
        },
        dryRun: { type: "boolean", description: "true (mặc định) = chỉ trả kế hoạch" },
      },
      required: ["dataSourceName"],
    },
  },
  {
    name: "migration_normalize_field_case",
    description:
      "Chuẩn hoá tên field entity về LOWERCASE + sửa lệch case dữ liệu trên bảng thật. " +
      "Bối cảnh: full-import lowercase key row, delta-sync (trước fix) giữ case cột MSSQL, " +
      "field mixed-case (vd tr_order.IsLock) → data nằm lẫn ext['islock']/ext['IsLock'] và " +
      "reads theo field trượt. Tool: (1) rename fields[].name → lowercase (check trùng), " +
      "(2) sửa key meta.storage.columns + searchable, (3) repair data: field cột-tier đổ " +
      "ext['cũ'] vào cột typed (COALESCE), field ext-tier gom về key lowercase. " +
      "dryRun=true trả kế hoạch không ghi. Bỏ entityName = quét mọi entity tier=table.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        entityName: {
          type: "string",
          description: "Chỉ chuẩn hoá 1 entity (bỏ trống = tất cả tier=table)",
        },
        dryRun: { type: "boolean", description: "true = chỉ trả kế hoạch, không ghi gì" },
      },
    },
  },
  {
    name: "migration_sync_entity_schema",
    description:
      "Đồng bộ schema entity tier=table: (a) MERGE các field mới (name/label/type) vào " +
      "entities.fields nếu chưa có; (b) chạy syncEntityTableSchema — ADD cột typed còn " +
      "thiếu cho MỌI field column-tier + cập nhật meta.storage.columns (merge jsonb). " +
      "Dùng sửa 2 loại gap do prepare tái dùng entity cũ: field thiếu so cột nguồn, và " +
      "field có nhưng storage.columns thiếu (data import bị vứt — vd dongia GVA). " +
      "Sau sync cần RE-IMPORT bảng để lấp giá trị.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        entityName: { type: "string", description: "Tên entity" },
        addFields: {
          type: "array",
          description: "Field cần bổ sung (bỏ qua nếu đã tồn tại)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              label: { type: "string" },
              type: { type: "string" },
            },
            required: ["name", "label", "type"],
          },
        },
      },
      required: ["entityName"],
    },
  },
  {
    name: "migration_dedup_rows",
    description:
      "Xoá row TRÙNG theo PK nguồn trong bảng thật của entity tier=table (hậu quả " +
      "2 worker import song song khi rolling deploy, hoặc sync re-insert vì PK '' " +
      "coerce thành NULL). Nhóm theo COALESCE(pk::text,''), GIỮ row mới nhất " +
      "(updated_at DESC), HARD DELETE các bản sao + dọn record_locator. " +
      "dryRun=true (mặc định) chỉ trả số liệu, không xoá.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        entityName: { type: "string", description: "Tên entity" },
        pkField: {
          type: "string",
          description: "Field PK nguồn để nhóm trùng (mặc định 'id')",
        },
        dryRun: { type: "boolean", description: "true (mặc định) = chỉ đếm, không xoá" },
      },
      required: ["entityName"],
    },
  },
  {
    name: "migration_query_readonly",
    description:
      "Chạy 1 câu SELECT/WITH CHỈ-ĐỌC trên PG prod để debug data migrate (so giá trị " +
      "mirror vs nguồn khi verify lệch). Guard: 1 statement, bắt đầu SELECT/WITH, không " +
      "dấu chấm phẩy giữa câu, tự bọc LIMIT 500. KHÔNG scope company tự động — caller " +
      "tự filter company_id khi đụng bảng dữ liệu.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Câu SELECT/WITH duy nhất" },
      },
      required: ["sql"],
    },
  },
  {
    name: "migration_repair_datetime_text",
    description:
      "REPAIR data: đổi giá trị cột date/datetime (text trên bảng thật) từ chuỗi locale JS " +
      "('Mon Jun 08 2026 07:59:26 GMT+0000 (...)' — do bug String(Date) cũ trong coerce) về " +
      "ISO ('2026-06-08T07:59:26+00:00'). Quét mọi entity tier=table, field type date/datetime " +
      "có cột typed; chỉ UPDATE row khớp pattern locale (idempotent, format-only). " +
      "dryRun=true trả số row ảnh hưởng per bảng/cột, không ghi.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        entityName: { type: "string", description: "Chỉ repair 1 entity (bỏ trống = tất cả)" },
        dryRun: { type: "boolean", description: "true = chỉ đếm, không ghi" },
      },
    },
  },
  {
    name: "migration_invoke_module_proc",
    description:
      "Gọi 1 proc Tier D đã port (module-procs registry) với args — phục vụ VERIFY " +
      "runtime so với golden MSSQL. CHÚ Ý: proc GHI sẽ ghi thật vào bảng (entity mirror " +
      "bị guard chặn sẵn) — chỉ dùng cho proc ĐỌC khi verify. Trả {ok, durationMs, " +
      "rowCount?, result} (result cắt 200KB).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Module plugin, mặc định 'ui_procs'" },
        name: {
          type: "string",
          description: "exportName của hàm (vd trOrderIslock) hoặc basename file (tr_order_islock)",
        },
        args: { type: "object", description: "Args truyền cho proc" },
      },
      required: ["name"],
    },
  },
  {
    name: "datasource_list",
    description:
      "Liệt kê DataSource (Nguồn dữ liệu) của công ty: id, name, label, baseEntityId, " +
      "số relation/field. Dùng để rà soát trước khi tạo mới (idempotent check).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "datasource_create_draft",
    description:
      "Tạo DataSource (Nguồn dữ liệu) — join nhiều entity dạng cây many-to-one + projection " +
      "field phẳng, thay proc SELECT cũ (nhóm query_datasource trong migrate). " +
      "config theo schema DataSourceConfig: { baseEntityId, relations[{id,alias,fromRelationId," +
      "fromField,toField,targetEntityId,joinKind}], fields[{key,sourceRelationId,sourceField," +
      "label,type,writable}], baseFilters?, sort?, defaultLimit? }. " +
      "Idempotent: name đã tồn tại → skip (overwrite=true mới ghi đè). " +
      "Mọi entityId trong config phải thuộc công ty (validate trước khi ghi).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Định danh máy ^[a-z][a-z0-9_]*$" },
        label: { type: "string", description: "Nhãn hiển thị" },
        icon: { type: "string" },
        config: { type: "object", description: "DataSourceConfig (xem mô tả)" },
        overwrite: { type: "boolean", description: "true = ghi đè datasource trùng tên" },
      },
      required: ["name", "label", "config"],
    },
  },
  {
    name: "datasource_preview",
    description:
      "Chạy THẬT resolver DataSource (resolveList — join batch-stitch / SQL join như app) trả " +
      "N dòng mẫu phẳng theo projection. Dùng VERIFY wiring: xác nhận cột join (vd mota, tenncc) " +
      "có data thật, không null hàng loạt. Role admin (không strip field). Chỉ ĐỌC. " +
      "Trả {total, fields[], rows[]} (cắt khi lớn).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        dataSourceName: { type: "string", description: "Tên DataSource (datasources.name)" },
        limit: { type: "number", description: "Số dòng mẫu (mặc định 5, tối đa 50)" },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Chỉ trả các key này (rỗng = mọi field projection)",
        },
      },
      required: ["dataSourceName"],
    },
  },
  {
    name: "entity_set_source",
    description:
      "Gắn meta.source (kind=migration, mssqlTable, connectionId) cho 1 entity — dùng khi " +
      "entity import bị thiếu source (bug cũ / promote crash) khiến rename + sync-link bỏ qua. " +
      "Merge jsonb, không ghi đè meta khác.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tên entity hiện tại" },
        mssqlTable: { type: "string", description: "vd 'dbo.tr_khachhang'" },
        connectionId: { type: "string", description: "UUID kết nối MSSQL (tuỳ chọn)" },
      },
      required: ["name", "mssqlTable"],
    },
  },
  {
    name: "migration_skip_job_table",
    description:
      "Đánh dấu SKIPPED các bảng trong 1 job full-import (bảng treo/lỗi vĩnh viễn — " +
      "vd bảng hệ thống nguồn không đọc được). skipped KHÔNG chặn job hoàn thành và " +
      "không retry. Dùng kèm migration_resume_full_job để job chạy tiếp các bảng còn lại.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "UUID job" },
        tableNames: {
          type: "array",
          items: { type: "string" },
          description: "Tên bảng cần skip, vd ['dbo.SYS_USER']",
        },
      },
      required: ["jobId", "tableNames"],
    },
  },
  {
    name: "migration_resume_full_job",
    description:
      "Re-enqueue 1 job full-import đang kẹt (worker chết, heartbeat stale): reset bảng " +
      "failed→pending, job→queued, đẩy lại vào queue. Bảng done/skipped không chạy lại; " +
      "bảng dở dang tiếp tục từ checkpoint lastPk.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "UUID job" },
      },
      required: ["jobId"],
    },
  },
  {
    name: "migration_enable_sync",
    description:
      "BẬT delta-sync cho 1 module (nhóm bảng): tạo module row (cron) + đăng ký từng bảng " +
      "với mode ct|rescan|manual. mode=rescan KHÔNG cần Change Tracking trên MSSQL (chỉ đọc, " +
      "quét toàn bảng so diff mỗi chu kỳ — nặng với bảng lớn, đặt cron thưa). " +
      "Tự gắn entity theo meta.source.mssqlTable + set meta.sync.state='mirror' " +
      "(chặn ghi từ ERP khi chạy song song). Idempotent.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "UUID kết nối MSSQL" },
        module: {
          type: "string",
          description: "Tên nhóm sync, vd 'dqhf_core' / 'dqhf_heavy'",
        },
        cronExpr: {
          type: "string",
          description: "Cron chu kỳ sync (mặc định */5 * * * *)",
        },
        tables: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              tableName: { type: "string", description: "vd 'dbo.tr_sanpham'" },
              pkColumn: { type: "string", description: "Cột PK (rescan bắt buộc cần)" },
              mode: { type: "string", enum: ["ct", "rescan", "manual"] },
            },
            required: ["tableName"],
          },
        },
      },
      required: ["connectionId", "module", "tables"],
    },
  },
  {
    name: "migration_start_full_import",
    description:
      "Tạo job full-import từ MSSQL. items = [{tableName, entityName, label, fields:[{name,label,type}]}] " +
      "(lấy từ migration_export_entities). targetTier='table' → import thẳng vào bảng thật " +
      "mang tên DB cũ (cần ERP_HYBRID_TABLES=1). Trả jobId — theo dõi bằng migration_get_full_job. " +
      "Worker stream theo PK, tự resume khi lỗi mạng.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "UUID kết nối MSSQL" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              tableName: { type: "string", description: "vd 'dbo.tr_sanpham'" },
              entityName: { type: "string", description: "^[a-z][a-z0-9_]*$" },
              label: { type: "string" },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    label: { type: "string" },
                    type: { type: "string" },
                  },
                  required: ["name", "label", "type"],
                },
              },
            },
            required: ["tableName", "entityName", "label", "fields"],
          },
        },
        targetTier: { type: "string", enum: ["eav", "table"] },
        batchSize: { type: "number", minimum: 100, maximum: 50000 },
      },
      required: ["connectionId", "items"],
    },
  },
];

/* ── Tool handlers ──────────────────────────────────────────── */
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type StorageMeta = { tier?: string; tableName?: string };
type SyncMeta = {
  state?: string;
  module?: string;
  lastSyncedAt?: string;
};
type EntityMeta = { storage?: StorageMeta; sync?: SyncMeta; agentSearchable?: boolean };

async function callMigrationTool(
  db: DB,
  companyId: string,
  scopes: string[],
  apiKeyCreatedBy: string | null,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const args = asObj(rawArgs);

  // Tool ghi yêu cầu scope migration:apply (deny-by-default).
  const def = TOOLS.find((t) => t.name === name);
  if (def?.level === "apply" && !hasMigrationScope(scopes, "apply")) {
    throw new McpError("Thiếu scope migration:apply cho tool ghi.", -32602);
  }

  switch (name) {
    /* ── migration_list_modules ─────────────────────────────── */
    case "migration_list_modules": {
      const rows = await db
        .select({
          id: migrationSyncModules.id,
          module: migrationSyncModules.module,
          enabled: migrationSyncModules.enabled,
          cronExpr: migrationSyncModules.cronExpr,
          heartbeatAt: migrationSyncModules.heartbeatAt,
          createdAt: migrationSyncModules.createdAt,
          updatedAt: migrationSyncModules.updatedAt,
          connectionId: migrationSyncModules.connectionId,
        })
        .from(migrationSyncModules)
        .where(
          and(
            eq(migrationSyncModules.companyId, companyId),
            args.enabled != null
              ? eq(migrationSyncModules.enabled, args.enabled as boolean)
              : undefined,
          ),
        )
        .orderBy(migrationSyncModules.module);

      // Tính stale: heartbeat > 10 phút → khả năng job crash.
      const now = Date.now();
      return rows.map((r) => ({
        ...r,
        heartbeatStale:
          r.heartbeatAt != null && now - new Date(r.heartbeatAt).getTime() > 10 * 60 * 1000,
      }));
    }

    /* ── migration_get_module ───────────────────────────────── */
    case "migration_get_module": {
      const module = String(args.module ?? "");
      if (!module) throw new McpError("module bắt buộc");

      const [mod] = await db
        .select()
        .from(migrationSyncModules)
        .where(
          and(
            eq(migrationSyncModules.companyId, companyId),
            eq(migrationSyncModules.module, module),
          ),
        );
      if (!mod) throw new McpError(`Module '${module}' không tồn tại`, -32602);

      const tables = await db
        .select({
          id: migrationSyncTables.id,
          tableName: migrationSyncTables.tableName,
          entityId: migrationSyncTables.entityId,
          mode: migrationSyncTables.mode,
          enabled: migrationSyncTables.enabled,
          status: migrationSyncTables.status,
          ctLastVersion: migrationSyncTables.ctLastVersion,
          srcCurrentVersion: migrationSyncTables.srcCurrentVersion,
          pendingChanges: migrationSyncTables.pendingChanges,
          insertsCount: migrationSyncTables.insertsCount,
          updatesCount: migrationSyncTables.updatesCount,
          deletesCount: migrationSyncTables.deletesCount,
          lastSyncedAt: migrationSyncTables.lastSyncedAt,
          lastError: migrationSyncTables.lastError,
        })
        .from(migrationSyncTables)
        .where(
          and(eq(migrationSyncTables.companyId, companyId), eq(migrationSyncTables.module, module)),
        )
        .orderBy(migrationSyncTables.tableName);

      return {
        module: mod,
        tables,
        summary: {
          total: tables.length,
          idle: tables.filter((t) => t.status === "idle").length,
          error: tables.filter((t) => t.status === "error").length,
          reseedRequired: tables.filter((t) => t.status === "reseed_required").length,
          totalPendingChanges: tables.reduce((s, t) => s + (t.pendingChanges ?? 0), 0),
        },
      };
    }

    /* ── migration_list_runs ────────────────────────────────── */
    case "migration_list_runs": {
      const module = String(args.module ?? "");
      if (!module) throw new McpError("module bắt buộc");
      const limit = Math.min(Number(args.limit ?? 50), 200);

      return db
        .select({
          id: migrationSyncRuns.id,
          module: migrationSyncRuns.module,
          tableName: migrationSyncRuns.tableName,
          startedAt: migrationSyncRuns.startedAt,
          finishedAt: migrationSyncRuns.finishedAt,
          durationMs: migrationSyncRuns.durationMs,
          inserts: migrationSyncRuns.inserts,
          updates: migrationSyncRuns.updates,
          deletes: migrationSyncRuns.deletes,
          error: migrationSyncRuns.error,
        })
        .from(migrationSyncRuns)
        .where(
          and(eq(migrationSyncRuns.companyId, companyId), eq(migrationSyncRuns.module, module)),
        )
        .orderBy(desc(migrationSyncRuns.startedAt))
        .limit(limit);
    }

    /* ── migration_list_full_jobs ───────────────────────────── */
    case "migration_list_full_jobs": {
      const limit = Math.min(Number(args.limit ?? 20), 50);
      return db
        .select({
          id: migrationFullJobs.id,
          status: migrationFullJobs.status,
          kind: migrationFullJobs.kind,
          totalTables: migrationFullJobs.totalTables,
          completedTables: migrationFullJobs.completedTables,
          totalRowsImported: migrationFullJobs.totalRowsImported,
          startedAt: migrationFullJobs.startedAt,
          completedAt: migrationFullJobs.completedAt,
          error: migrationFullJobs.error,
          createdAt: migrationFullJobs.createdAt,
        })
        .from(migrationFullJobs)
        .where(
          and(
            eq(migrationFullJobs.companyId, companyId),
            args.status ? eq(migrationFullJobs.status, args.status as string) : undefined,
          ),
        )
        .orderBy(desc(migrationFullJobs.createdAt))
        .limit(limit);
    }

    /* ── migration_get_full_job ─────────────────────────────── */
    case "migration_get_full_job": {
      const jobId = String(args.jobId ?? "");
      if (!jobId) throw new McpError("jobId bắt buộc");

      const [job] = await db
        .select()
        .from(migrationFullJobs)
        .where(and(eq(migrationFullJobs.id, jobId), eq(migrationFullJobs.companyId, companyId)));
      if (!job) throw new McpError(`Job '${jobId}' không tồn tại`, -32602);

      const tables = await db
        .select({
          id: migrationFullJobTables.id,
          tableName: migrationFullJobTables.tableName,
          entityName: migrationFullJobTables.entityName,
          pkColumn: migrationFullJobTables.pkColumn,
          lastPk: migrationFullJobTables.lastPk,
          rowsImported: migrationFullJobTables.rowsImported,
          batchSize: migrationFullJobTables.batchSize,
          status: migrationFullJobTables.status,
          srcCount: migrationFullJobTables.srcCount,
          tgtCount: migrationFullJobTables.tgtCount,
          reconcile: migrationFullJobTables.reconcile,
          error: migrationFullJobTables.error,
          updatedAt: migrationFullJobTables.updatedAt,
        })
        .from(migrationFullJobTables)
        .where(eq(migrationFullJobTables.jobId, jobId))
        .orderBy(migrationFullJobTables.tableName);

      return { job, tables };
    }

    /* ── entity_list ────────────────────────────────────────── */
    case "entity_list": {
      const rows = await db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          icon: entities.icon,
          meta: entities.meta,
          fields: sql<number>`jsonb_array_length(${entities.fields})`.as("field_count"),
          updatedAt: entities.updatedAt,
        })
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      return rows
        .map((r) => {
          const meta = (r.meta ?? {}) as EntityMeta;
          const tier = meta.storage?.tier ?? "eav";
          return {
            id: r.id,
            name: r.name,
            label: r.label,
            icon: r.icon,
            storageTier: tier,
            tableName: meta.storage?.tableName,
            fieldCount: r.fields,
            agentSearchable: meta.agentSearchable ?? false,
            syncState: meta.sync?.state,
            syncModule: meta.sync?.module,
            syncLastAt: meta.sync?.lastSyncedAt,
            updatedAt: r.updatedAt,
          };
        })
        .filter((r) => !args.storageTier || r.storageTier === args.storageTier);
    }

    /* ── entity_get ─────────────────────────────────────────── */
    case "entity_get": {
      const entityName = String(args.name ?? "");
      const entityId = String(args.id ?? "");
      if (!entityName && !entityId) throw new McpError("name hoặc id bắt buộc");

      const [row] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.companyId, companyId),
            entityId
              ? eq(entities.id, entityId)
              : sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        );
      if (!row) {
        throw new McpError(
          `Entity '${entityName || entityId}' không tồn tại trong công ty`,
          -32602,
        );
      }

      const meta = (row.meta ?? {}) as EntityMeta;
      return {
        id: row.id,
        name: row.name,
        label: row.label,
        icon: row.icon,
        fields: row.fields,
        storageTier: meta.storage?.tier ?? "eav",
        tableName: meta.storage?.tableName,
        // Map field→cột vật lý (tier=table) — nguồn sự thật khi viết SQL thô.
        storageColumns: (meta.storage as EntityStorage | undefined)?.columns ?? null,
        agentSearchable: meta.agentSearchable ?? false,
        sync: meta.sync ?? null,
        updatedAt: row.updatedAt,
      };
    }

    /* ── migration_inspect_table ────────────────────────────── */
    case "migration_inspect_table": {
      const entityName = String(args.entityName ?? "").trim();
      if (!entityName) throw new McpError("entityName bắt buộc");

      const [row] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.companyId, companyId),
            sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        );
      if (!row) throw new McpError(`Entity '${entityName}' không tồn tại trong công ty`, -32602);

      const meta = (row.meta ?? {}) as EntityMeta;
      const storage = meta.storage as EntityStorage | undefined;
      if (storage?.tier !== "table" || !storage.tableName) {
        throw new McpError(
          `Entity '${entityName}' không phải tier=table (đang ${storage?.tier ?? "eav"})`,
        );
      }
      // tableName lấy từ meta đã qua assertIdent khi tạo — re-validate trước khi
      // nội suy (chống meta hỏng), KHÔNG nhận tên bảng trực tiếp từ caller.
      const tbl = assertIdent(storage.tableName);

      const colsRes = (await db.execute(
        sql`SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tbl}
            ORDER BY ordinal_position`,
      )) as unknown as
        | Array<{ column_name: string; data_type: string; is_nullable: string }>
        | { rows: Array<{ column_name: string; data_type: string; is_nullable: string }> };
      const physicalColumns = Array.isArray(colsRes) ? colsRes : (colsRes.rows ?? []);

      let rowCount = -1;
      try {
        const r = (await db.execute(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${tbl}"`)} WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL`,
        )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
        const list = Array.isArray(r) ? r : (r.rows ?? []);
        rowCount = Number(list[0]?.n ?? 0);
      } catch {
        /* đếm lỗi không chặn introspect */
      }

      // Field không có cột typed → nằm trong ext jsonb (key = tên field).
      const fieldDefs = (row.fields ?? []) as Array<{ name: string; type: string }>;
      const colMap = storage.columns ?? {};
      const extFields = fieldDefs
        .filter((f) => !colMap[f.name])
        .map((f) => ({ field: f.name, type: f.type, access: `ext->>'${f.name}'` }));

      return {
        entityName: row.name,
        tableName: tbl,
        physicalColumns,
        fieldColumnMap: colMap,
        extFields,
        rowCount,
      };
    }

    /* ── migration_list_connections ─────────────────────────── */
    case "migration_list_connections": {
      return db
        .select({
          id: mssqlConnections.id,
          name: mssqlConnections.name,
          host: mssqlConnections.host,
          port: mssqlConnections.port,
          database: mssqlConnections.database,
          username: mssqlConnections.username,
          encrypt: mssqlConnections.encrypt,
          trustServerCert: mssqlConnections.trustServerCert,
          allowWrite: mssqlConnections.allowWrite,
          isDefault: mssqlConnections.isDefault,
          createdAt: mssqlConnections.createdAt,
        })
        .from(mssqlConnections)
        .where(eq(mssqlConnections.companyId, companyId))
        .orderBy(mssqlConnections.name);
    }

    /* ── entity_set_agent_searchable (apply) ────────────────── */
    case "entity_set_agent_searchable": {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      const enabled = args.enabled === true;
      if (names.length === 0) throw new McpError("names bắt buộc (mảng tên entity)");
      if (names.length > 50) throw new McpError("Tối đa 50 entity mỗi lần");

      const results: Array<{ name: string; status: "ok" | "not_found" }> = [];
      for (const entityName of names) {
        // Merge jsonb — KHÔNG ghi đè meta (giữ storage/source/sync, bài học #20).
        const updated = await db
          .update(entities)
          .set({
            meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ agentSearchable: enabled })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(entities.companyId, companyId),
              sql`lower(${entities.name}) = lower(${entityName})`,
            ),
          )
          .returning({ id: entities.id });
        results.push({ name: entityName, status: updated.length > 0 ? "ok" : "not_found" });
      }
      return { enabled, results };
    }

    /* ── migration_rename_promoted_tables (apply) ───────────── */
    case "migration_rename_promoted_tables": {
      if (!isHybridTablesEnabled()) {
        throw new McpError("Cần bật ERP_HYBRID_TABLES=1 trên server.", -32603);
      }
      return renamePromotedTablesForCompany(db, companyId);
    }

    /* ── migration_export_entities (read) ───────────────────── */
    case "migration_export_entities": {
      const rows = await db
        .select()
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      const imported: Array<Record<string, unknown>> = [];
      const kept: Array<{ name: string; label: string; storageTier: string }> = [];

      for (const e of rows) {
        const meta = (e.meta ?? {}) as EntityMeta & {
          source?: { mssqlTable?: string; connectionId?: string };
        };
        const tier = meta.storage?.tier ?? "eav";
        if (!meta.source?.mssqlTable) {
          kept.push({ name: e.name, label: e.label, storageTier: tier });
          continue;
        }
        // Đếm record: bảng thật → COUNT bảng; EAV → COUNT entity_records.
        let recordCount = 0;
        try {
          if (tier === "table" && meta.storage?.tableName) {
            // assertIdent: tableName từ meta jsonb — validate trước khi sql.raw
            // (cùng validator với dropTableForEntity, chống injection nếu meta hỏng).
            const r = (await db.execute(
              sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${assertIdent(meta.storage.tableName)}"`)} WHERE company_id = ${companyId}::uuid`,
            )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
            const list = Array.isArray(r) ? r : (r.rows ?? []);
            recordCount = Number(list[0]?.n ?? 0);
          } else {
            const r = (await db.execute(
              sql`SELECT count(*)::int AS n FROM entity_records WHERE company_id = ${companyId}::uuid AND entity_id = ${e.id}::uuid`,
            )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
            const list = Array.isArray(r) ? r : (r.rows ?? []);
            recordCount = Number(list[0]?.n ?? 0);
          }
        } catch {
          recordCount = -1; // đếm lỗi (bảng đã drop?) — không chặn export
        }
        imported.push({
          entityId: e.id,
          name: e.name,
          label: e.label,
          mssqlTable: meta.source.mssqlTable,
          connectionId: meta.source.connectionId,
          fields: e.fields,
          storageTier: tier,
          tableName: meta.storage?.tableName,
          agentSearchable: meta.agentSearchable ?? false,
          recordCount,
        });
      }
      return { imported, importedCount: imported.length, kept, keptCount: kept.length };
    }

    /* ── migration_delete_imported_entities (apply) ─────────── */
    case "migration_delete_imported_entities": {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      if (names.length === 0) throw new McpError("names bắt buộc (mảng tên entity)");
      if (names.length > 200) throw new McpError("Tối đa 200 entity mỗi lần");
      const force = args.force === true;

      const results: Array<{
        name: string;
        status: "deleted" | "skipped_no_source" | "not_found";
        droppedTable?: string;
      }> = [];
      for (const entityName of names) {
        const [e] = await db
          .select({ id: entities.id, meta: entities.meta })
          .from(entities)
          .where(
            and(
              eq(entities.companyId, companyId),
              sql`lower(${entities.name}) = lower(${entityName})`,
            ),
          );
        if (!e) {
          results.push({ name: entityName, status: "not_found" });
          continue;
        }
        const meta = (e.meta ?? {}) as EntityMeta & { source?: { mssqlTable?: string } };
        // GUARD: chỉ xoá entity import (có nguồn MSSQL) — entity tạo tay từ chối.
        // force=true bỏ guard: import cũ bị bug ghi-đè meta xoá mất source
        // (danh sách names vẫn tường minh, user duyệt trước).
        if (!force && !meta.source?.mssqlTable) {
          results.push({ name: entityName, status: "skipped_no_source" });
          continue;
        }
        let droppedTable: string | undefined;
        if (meta.storage?.tier === "table" && meta.storage.tableName) {
          await dropTableForEntity(db, companyId, e.id, meta.storage as EntityStorage);
          droppedTable = meta.storage.tableName;
        }
        await db
          .delete(entities)
          .where(and(eq(entities.id, e.id), eq(entities.companyId, companyId)));
        results.push({ name: entityName, status: "deleted", droppedTable });
      }
      return {
        results,
        deleted: results.filter((r) => r.status === "deleted").length,
      };
    }

    /* ── entity_rename_to_source (apply) ────────────────────── */
    case "entity_rename_to_source": {
      const rows = await db
        .select({ id: entities.id, name: entities.name, meta: entities.meta })
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      const results: Array<{
        from: string;
        to: string;
        status: "renamed" | "skip" | "error";
        reason?: string;
      }> = [];
      for (const e of rows) {
        const meta = (e.meta ?? {}) as EntityMeta & { source?: { mssqlTable?: string } };
        const src = meta.source?.mssqlTable;
        if (!src) continue;
        // "dbo.tr_order_detail" → "tr_order_detail"; sanitize về ^[a-z][a-z0-9_]*$.
        const base = (src.includes(".") ? (src.split(".").pop() ?? src) : src)
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_");
        const to = /^[a-z]/.test(base) ? base : `t_${base}`;
        if (to === e.name) {
          results.push({ from: e.name, to, status: "skip", reason: "đã đúng tên" });
          continue;
        }
        // Unique (companyId, lower(name)) — trùng entity khác → skip an toàn.
        const [dup] = await db
          .select({ id: entities.id })
          .from(entities)
          .where(
            and(eq(entities.companyId, companyId), sql`lower(${entities.name}) = lower(${to})`),
          );
        if (dup) {
          results.push({
            from: e.name,
            to,
            status: "skip",
            reason: "tên đã được entity khác dùng",
          });
          continue;
        }
        try {
          await db
            .update(entities)
            .set({ name: to, updatedAt: new Date() })
            .where(and(eq(entities.id, e.id), eq(entities.companyId, companyId)));
          results.push({ from: e.name, to, status: "renamed" });
        } catch (err) {
          results.push({ from: e.name, to, status: "error", reason: (err as Error).message });
        }
      }
      return { results, renamed: results.filter((r) => r.status === "renamed").length };
    }

    /* ── page_list (read) ───────────────────────────────────── */
    case "page_list": {
      const rows = await db
        .select({
          id: pages.id,
          name: pages.name,
          label: pages.label,
          published: pages.published,
          content: pages.content,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .where(eq(pages.companyId, companyId))
        .orderBy(pages.name);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        label: r.label,
        published: r.published,
        widgets: Array.isArray(r.content) ? r.content.length : 0,
        updatedAt: r.updatedAt,
      }));
    }

    /* ── page_delete (apply) ────────────────────────────────── */
    case "page_delete": {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      if (names.length === 0) throw new McpError("names bắt buộc");
      if (names.length > 200) throw new McpError("Tối đa 200 page mỗi lần");
      const results: Array<{ name: string; status: "deleted" | "not_found" }> = [];
      for (const n of names) {
        const del = await db
          .delete(pages)
          .where(and(eq(pages.companyId, companyId), sql`lower(${pages.name}) = lower(${n})`))
          .returning({ id: pages.id });
        results.push({ name: n, status: del.length > 0 ? "deleted" : "not_found" });
      }
      return { results, deleted: results.filter((r) => r.status === "deleted").length };
    }

    /* ── page_create_draft (apply) ──────────────────────────── */
    case "page_create_draft": {
      const pageName = String(args.name ?? "");
      const label = String(args.label ?? "");
      if (!/^[a-z][a-z0-9_]*$/.test(pageName)) {
        throw new McpError("name sai định dạng (^[a-z][a-z0-9_]*$)");
      }
      if (!label) throw new McpError("label bắt buộc");
      const content = Array.isArray(args.content) ? args.content : null;
      if (!content || content.length === 0)
        throw new McpError("content bắt buộc (PageComponent[])");
      if (content.length > 50) throw new McpError("Tối đa 50 widget mỗi page");

      const [exists] = await db
        .select({ id: pages.id, published: pages.published })
        .from(pages)
        .where(and(eq(pages.companyId, companyId), sql`lower(${pages.name}) = lower(${pageName})`));
      if (exists) {
        // overwrite CHỈ áp cho draft — page đã publish (người dùng đang xài)
        // tuyệt đối không đè.
        if (args.overwrite === true && exists.published === false) {
          await db
            .update(pages)
            .set({
              label,
              ...(args.icon ? { icon: String(args.icon) } : {}),
              content,
              updatedAt: new Date(),
            })
            .where(eq(pages.id, exists.id));
          return { status: "overwritten", pageId: exists.id, name: pageName };
        }
        return { status: "skipped_exists", pageId: exists.id, name: pageName };
      }

      const [row] = await db
        .insert(pages)
        .values({
          companyId,
          name: pageName,
          label,
          icon: args.icon ? String(args.icon) : null,
          content,
          published: false,
        })
        .returning({ id: pages.id });
      return { status: "created", pageId: row?.id, name: pageName };
    }

    /* ── page_wire_datasource (apply) ───────────────────────── */
    case "page_wire_datasource": {
      const dsName = String(args.dataSourceName ?? "").trim();
      if (!dsName) throw new McpError("dataSourceName bắt buộc");
      const addFields = (Array.isArray(args.addFields) ? args.addFields : []).map((s) => String(s));
      const setFields = (Array.isArray(args.setFields) ? args.setFields : []).map((s) => String(s));
      const pageFilter = (Array.isArray(args.pageNames) ? args.pageNames : []).map((s) =>
        String(s).toLowerCase(),
      );
      const dryRun = args.dryRun !== false; // mặc định AN TOÀN

      const [ds] = await db
        .select({ id: dataSources.id, config: dataSources.config })
        .from(dataSources)
        .where(
          and(
            eq(dataSources.companyId, companyId),
            sql`lower(${dataSources.name}) = lower(${dsName})`,
          ),
        );
      if (!ds) throw new McpError(`DataSource '${dsName}' không tồn tại`);
      const dsCfg = (ds.config ?? {}) as {
        baseEntityId?: string;
        fields?: Array<{ key?: string }>;
      };
      const baseEntityId = dsCfg.baseEntityId;
      if (!baseEntityId) throw new McpError(`DataSource '${dsName}' chưa có baseEntityId`);
      const projKeys = new Set((dsCfg.fields ?? []).map((f) => String(f.key)));
      const badAdd = addFields.filter((f) => !projKeys.has(f));
      if (badAdd.length > 0) {
        throw new McpError(`addFields không có trong projection DataSource: ${badAdd.join(", ")}`);
      }
      const badSet = setFields.filter((f) => !projKeys.has(f));
      if (badSet.length > 0) {
        throw new McpError(`setFields không có trong projection DataSource: ${badSet.join(", ")}`);
      }

      const pageRows = await db
        .select({
          id: pages.id,
          name: pages.name,
          content: pages.content,
          published: pages.published,
        })
        .from(pages)
        .where(eq(pages.companyId, companyId));

      const changed: Array<{ page: string; widgets: number; addedFields: string[] }> = [];
      const skippedPublished: string[] = [];

      for (const p of pageRows) {
        if (pageFilter.length > 0 && !pageFilter.includes(p.name.toLowerCase())) continue;
        const content = Array.isArray(p.content)
          ? (p.content as Array<Record<string, unknown>>)
          : [];
        let widgetsChanged = 0;
        const addedSet = new Set<string>();
        for (const comp of content) {
          const cfg = comp.config as Record<string, unknown> | undefined;
          if (!cfg || cfg.entity !== baseEntityId) continue;
          // Đã wire DS khác → bỏ (không ghi đè binding sẵn có).
          if (cfg.dataSourceId && cfg.dataSourceId !== ds.id) continue;
          cfg.dataSourceId = ds.id;
          if (setFields.length > 0) {
            // Thay TRỌN theo thứ tự DQHF (ưu tiên hơn addFields).
            cfg.fields = [...setFields];
            for (const f of setFields) addedSet.add(f);
          } else if (addFields.length > 0) {
            const cur = Array.isArray(cfg.fields) ? (cfg.fields as string[]).map(String) : [];
            for (const f of addFields) {
              if (!cur.includes(f)) {
                cur.push(f);
                addedSet.add(f);
              }
            }
            cfg.fields = cur;
          }
          widgetsChanged++;
        }
        if (widgetsChanged === 0) continue;
        if (p.published) {
          skippedPublished.push(p.name);
          continue; // KHÔNG đụng page đã publish
        }
        changed.push({ page: p.name, widgets: widgetsChanged, addedFields: [...addedSet] });
        if (!dryRun) {
          await db.update(pages).set({ content, updatedAt: new Date() }).where(eq(pages.id, p.id));
        }
      }

      return {
        dataSource: dsName,
        dryRun,
        pagesChanged: changed.length,
        widgetsChanged: changed.reduce((s, c) => s + c.widgets, 0),
        changed,
        skippedPublished,
      };
    }

    /* ── migration_normalize_field_case (apply) ─────────────── */
    case "migration_normalize_field_case": {
      const onlyName = args.entityName ? String(args.entityName).trim().toLowerCase() : null;
      const dryRun = args.dryRun === true;

      const rows = await db
        .select()
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      const report: Array<Record<string, unknown>> = [];

      for (const e of rows) {
        if (onlyName && e.name.toLowerCase() !== onlyName) continue;
        const meta = (e.meta ?? {}) as EntityMeta;
        const storage = meta.storage as EntityStorage | undefined;
        if (storage?.tier !== "table" || !storage.tableName) continue;

        const fields = (e.fields ?? []) as Array<Record<string, unknown> & { name: string }>;
        const renames = fields
          .map((f) => f.name)
          .filter((n) => n !== n.toLowerCase())
          .map((n) => ({ from: n, to: n.toLowerCase() }));
        if (renames.length === 0) continue;

        // Check trùng sau lowercase (vd có cả "IsLock" lẫn "islock").
        const lowerCounts = new Map<string, number>();
        for (const f of fields) {
          const k = f.name.toLowerCase();
          lowerCounts.set(k, (lowerCounts.get(k) ?? 0) + 1);
        }
        const collisions = renames.filter((r) => (lowerCounts.get(r.to) ?? 0) > 1);
        if (collisions.length > 0) {
          report.push({
            entity: e.name,
            status: "skipped_collision",
            collisions: collisions.map((c) => c.from),
          });
          continue;
        }

        if (dryRun) {
          report.push({ entity: e.name, status: "plan", renames });
          continue;
        }

        const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
        const newFields = fields.map((f) =>
          f.name === f.name.toLowerCase() ? f : { ...f, name: f.name.toLowerCase() },
        );
        const newColumns: Record<string, { col: string; pgType: string }> = {};
        for (const [k, v] of Object.entries(storage.columns ?? {})) {
          newColumns[k.toLowerCase()] = v;
        }
        const newSearchable = (storage.searchable ?? []).map((s) => s.toLowerCase());
        const repaired: Array<{ field: string; rows: number }> = [];

        await db.transaction(async (tx) => {
          for (const r of renames) {
            const colMap = (storage.columns ?? {})[r.from] ?? (storage.columns ?? {})[r.to];
            // Giá trị có thể nằm ở ext theo key cũ (sync ghi case gốc) hoặc
            // key lowercase (import ghi lowercase nhưng field lúc đó mixed-case
            // → không match → rớt vào ext lowercase).
            const oldKey = r.from;
            const lowKey = r.to;
            let res: unknown;
            if (colMap) {
              // Cột-tier: đổ giá trị ext (ưu tiên key gốc) vào cột typed nếu
              // cột đang NULL, rồi dọn cả 2 key ext.
              const col = sql.raw(`"${assertIdent(colMap.col)}"`);
              // ::text BẮT BUỘC trên mọi bind param làm key jsonb — toán tử
              // `jsonb - ?` / `jsonb -> ?` nhập nhằng (text vs integer) với
              // param không kiểu → PG fail "could not determine data type".
              const castVal =
                colMap.pgType === "numeric"
                  ? sql`nullif(COALESCE(ext->>${oldKey}::text, ext->>${lowKey}::text), '')::numeric`
                  : colMap.pgType === "boolean"
                    ? sql`nullif(COALESCE(ext->>${oldKey}::text, ext->>${lowKey}::text), '')::boolean`
                    : sql`COALESCE(ext->>${oldKey}::text, ext->>${lowKey}::text)`;
              res = await tx.execute(
                sql`UPDATE ${tbl}
                    SET ${col} = COALESCE(${col}, ${castVal}),
                        ext = (ext - ${oldKey}::text) - ${lowKey}::text,
                        updated_at = now()
                    WHERE company_id = ${companyId}::uuid AND (ext ? ${oldKey}::text OR ext ? ${lowKey}::text)
                    RETURNING id`,
              );
            } else {
              // Ext-tier: gom về key lowercase (ưu tiên giá trị key gốc nếu cả 2 có).
              res = await tx.execute(
                sql`UPDATE ${tbl}
                    SET ext = ((ext - ${oldKey}::text) - ${lowKey}::text)
                          || jsonb_build_object(${lowKey}::text, COALESCE(ext->${oldKey}::text, ext->${lowKey}::text)),
                        updated_at = now()
                    WHERE company_id = ${companyId}::uuid AND (ext ? ${oldKey}::text OR ext ? ${lowKey}::text)
                    RETURNING id`,
              );
            }
            const list = Array.isArray(res)
              ? (res as unknown[])
              : ((res as { rows?: unknown[] }).rows ?? []);
            repaired.push({ field: r.from, rows: list.length });
          }

          // Merge meta (bài học #20 — không ghi đè meta).
          const nextStorage = { ...storage, columns: newColumns, searchable: newSearchable };
          await tx
            .update(entities)
            .set({
              fields: newFields,
              meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ storage: nextStorage })}::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(entities.id, e.id));
        });

        report.push({ entity: e.name, status: "normalized", renames, repaired });
      }

      return { count: report.length, report };
    }

    /* ── migration_sync_entity_schema (apply) ───────────────── */
    case "migration_sync_entity_schema": {
      const entityName = String(args.entityName ?? "").trim();
      if (!entityName) throw new McpError("entityName bắt buộc");
      const addFields = Array.isArray(args.addFields)
        ? (args.addFields as Array<{ name: string; label: string; type: string }>)
        : [];

      const [row] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.companyId, companyId),
            sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        );
      if (!row) throw new McpError(`Entity '${entityName}' không tồn tại`);
      const meta = (row.meta ?? {}) as EntityMeta;
      const storage = meta.storage as EntityStorage | undefined;
      if (storage?.tier !== "table" || !storage.tableName) {
        throw new McpError(`Entity '${entityName}' không phải tier=table`);
      }

      // (a) merge field mới (theo name lowercase, không trùng).
      const fields = [...((row.fields ?? []) as Array<Record<string, unknown> & { name: string }>)];
      const have = new Set(fields.map((f) => f.name.toLowerCase()));
      const added: string[] = [];
      for (const f of addFields) {
        const n = String(f.name ?? "").toLowerCase();
        if (!n || have.has(n)) continue;
        fields.push({
          id: `mf_${n}`,
          name: n,
          label: String(f.label ?? n),
          type: String(f.type ?? "text"),
        });
        have.add(n);
        added.push(n);
      }

      // (b) sync schema: ADD cột typed thiếu + meta.storage mới.
      const nextStorage = await syncEntityTableSchema(
        db,
        storage,
        fields as unknown as Parameters<typeof syncEntityTableSchema>[2],
      );
      await db
        .update(entities)
        .set({
          fields,
          // Merge jsonb — KHÔNG ghi đè meta (bài học #20).
          meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ storage: nextStorage })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, row.id));

      return {
        entity: row.name,
        addedFields: added,
        columnsBefore: Object.keys(storage.columns ?? {}).length,
        columnsAfter: Object.keys(nextStorage.columns ?? {}).length,
      };
    }

    /* ── migration_dedup_rows (apply) ───────────────────────── */
    case "migration_dedup_rows": {
      const entityName = String(args.entityName ?? "").trim();
      if (!entityName) throw new McpError("entityName bắt buộc");
      const pkField = String(args.pkField ?? "id")
        .trim()
        .toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(pkField)) throw new McpError("pkField sai định dạng");
      const dryRun = args.dryRun !== false; // mặc định AN TOÀN: chỉ đếm

      const [row] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.companyId, companyId),
            sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        );
      if (!row) throw new McpError(`Entity '${entityName}' không tồn tại`);
      const meta = (row.meta ?? {}) as EntityMeta;
      const storage = meta.storage as EntityStorage | undefined;
      if (storage?.tier !== "table" || !storage.tableName) {
        throw new McpError(`Entity '${entityName}' không phải tier=table`);
      }
      if (!/^[a-z][a-z0-9_]*$/.test(storage.tableName)) {
        throw new McpError(`tableName '${storage.tableName}' sai định dạng`);
      }
      const colMap = (storage.columns ?? {})[pkField];
      if (colMap && !/^[a-z][a-z0-9_]*$/.test(colMap.col)) {
        throw new McpError(`Cột '${colMap.col}' sai định dạng`);
      }
      const tblE = sql.raw(`"${storage.tableName}"`);
      // COALESCE(...,'') khớp hành vi lookup import/sync — bản sao do PK ''
      // (coerce → NULL ở cột typed) gom chung 1 nhóm. PK nguồn unique nên 1
      // nhóm = 1 row gốc + các bản sao; giữ bản MỚI NHẤT (re-import/sync vừa
      // refresh), xoá HẲN phần còn lại + record_locator của chúng.
      const pkE = colMap
        ? sql.raw(`COALESCE("${colMap.col}"::text, '')`)
        : sql`COALESCE(ext->>${pkField}, '')`;
      const dupCte = sql`WITH dup AS (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY ${pkE}
            ORDER BY updated_at DESC, created_at DESC, id DESC
          ) AS rn
          FROM ${tblE}
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        ) s WHERE rn > 1
      )`;
      if (dryRun) {
        const res = (await db.execute(
          sql`${dupCte} SELECT count(*)::int AS n FROM dup`,
        )) as unknown as Array<{ n: number }> | { rows?: Array<{ n: number }> };
        const list = Array.isArray(res) ? res : (res.rows ?? []);
        return {
          entity: row.name,
          table: storage.tableName,
          pkField,
          dryRun: true,
          duplicates: Number(list[0]?.n ?? 0),
        };
      }
      const res = (await db.execute(
        sql`${dupCte},
        del AS (
          DELETE FROM ${tblE} WHERE id IN (SELECT id FROM dup) RETURNING id
        ),
        loc AS (
          DELETE FROM record_locator WHERE id IN (SELECT id FROM del) RETURNING id
        )
        SELECT (SELECT count(*) FROM del)::int AS deleted,
               (SELECT count(*) FROM loc)::int AS locators`,
      )) as unknown as
        | Array<{ deleted: number; locators: number }>
        | { rows?: Array<{ deleted: number; locators: number }> };
      const list = Array.isArray(res) ? res : (res.rows ?? []);
      return {
        entity: row.name,
        table: storage.tableName,
        pkField,
        dryRun: false,
        deleted: Number(list[0]?.deleted ?? 0),
        locatorsRemoved: Number(list[0]?.locators ?? 0),
      };
    }

    /* ── migration_query_readonly (apply) ───────────────────── */
    case "migration_query_readonly": {
      const raw = String(args.sql ?? "").trim();
      if (!raw) throw new McpError("sql bắt buộc");
      // Guard chỉ-đọc: 1 statement SELECT/WITH, chặn chấm phẩy (đa câu) +
      // các từ khoá ghi ở mức token đầu. (Không chống được mọi trò — tool
      // gated scope migration:apply, cùng mức tin cậy start_full_import.)
      const oneStmt = raw.replace(/;\s*$/, "");
      if (oneStmt.includes(";")) throw new McpError("Chỉ 1 statement (không dấu chấm phẩy)");
      if (!/^(select|with)\b/i.test(oneStmt)) throw new McpError("Chỉ SELECT/WITH");
      if (/\b(insert|update|delete|merge|drop|truncate|alter|create|grant|copy)\b/i.test(oneStmt)) {
        throw new McpError("Phát hiện từ khoá ghi — từ chối");
      }
      const limited = `SELECT * FROM (${oneStmt}) _q LIMIT 500`;
      const res = (await db.execute(sql.raw(limited))) as unknown as
        | Array<Record<string, unknown>>
        | { rows: Array<Record<string, unknown>> };
      const list = Array.isArray(res) ? res : (res.rows ?? []);
      const json = JSON.stringify(list);
      return {
        rowCount: list.length,
        rows: json.length > 150_000 ? JSON.parse(`${json.slice(0, 0)}[]`) : list,
        truncatedNote: json.length > 150_000 ? "kết quả quá lớn — thu hẹp SELECT" : undefined,
      };
    }

    /* ── migration_repair_datetime_text (apply) ─────────────── */
    case "migration_repair_datetime_text": {
      const onlyName = args.entityName ? String(args.entityName).trim().toLowerCase() : null;
      const dryRun = args.dryRun === true;

      // Chuỗi locale JS fixed-width: "Mon Jun 08 2026 07:59:26 GMT+0000 (...)"
      // vị trí: thứ 1-3, tháng 5-7, ngày 9-10, năm 12-15, giờ 17-24,
      // 'GMT' 26-28, dấu 29, tz-giờ 30-31, tz-phút 32-33.
      const LOCALE_RE =
        "^[A-Z][a-z]{2} [A-Z][a-z]{2} \\d{2} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT[+-]\\d{4}";

      const rows2 = await db
        .select()
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      const report: Array<{ entity: string; field: string; col: string; rows: number }> = [];
      let totalRows = 0;

      for (const e of rows2) {
        if (onlyName && e.name.toLowerCase() !== onlyName) continue;
        const meta = (e.meta ?? {}) as EntityMeta;
        const storage = meta.storage as EntityStorage | undefined;
        if (storage?.tier !== "table" || !storage.tableName) continue;
        const fields = (e.fields ?? []) as Array<{ name: string; type: string }>;
        const dateFields = fields.filter((f) => f.type === "date" || f.type === "datetime");
        if (dateFields.length === 0) continue;
        const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);

        for (const f of dateFields) {
          const colMap = storage.columns?.[f.name];
          if (!colMap) continue; // ext-tier (hiếm) — bỏ qua
          const colIdent = `"${assertIdent(colMap.col)}"`;
          const col = sql.raw(colIdent);
          if (dryRun) {
            const res = (await db.execute(
              sql`SELECT count(*)::int AS n FROM ${tbl} WHERE company_id = ${companyId}::uuid AND ${col}::text ~ ${LOCALE_RE}::text`,
            )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
            const list = Array.isArray(res) ? res : (res.rows ?? []);
            const n = Number(list[0]?.n ?? 0);
            if (n > 0) {
              report.push({ entity: e.name, field: f.name, col: colMap.col, rows: n });
              totalRows += n;
            }
            continue;
          }
          const mc = sql.raw(
            `CASE substring(${colIdent} from 5 for 3) ` +
              `WHEN 'Jan' THEN '01' WHEN 'Feb' THEN '02' WHEN 'Mar' THEN '03' ` +
              `WHEN 'Apr' THEN '04' WHEN 'May' THEN '05' WHEN 'Jun' THEN '06' ` +
              `WHEN 'Jul' THEN '07' WHEN 'Aug' THEN '08' WHEN 'Sep' THEN '09' ` +
              `WHEN 'Oct' THEN '10' WHEN 'Nov' THEN '11' WHEN 'Dec' THEN '12' END`,
          );
          const res = (await db.execute(
            sql`UPDATE ${tbl} SET ${col} =
                  substring(${col} from 12 for 4) || '-' || ${mc} || '-' ||
                  substring(${col} from 9 for 2) || 'T' ||
                  substring(${col} from 17 for 8) ||
                  substring(${col} from 29 for 3) || ':' ||
                  substring(${col} from 32 for 2)
                WHERE company_id = ${companyId}::uuid AND ${col}::text ~ ${LOCALE_RE}::text
                RETURNING id`,
          )) as unknown as Array<unknown> | { rows: Array<unknown> };
          const list = Array.isArray(res) ? res : (res.rows ?? []);
          if (list.length > 0) {
            report.push({ entity: e.name, field: f.name, col: colMap.col, rows: list.length });
            totalRows += list.length;
          }
        }
      }

      return { dryRun, totalRows, entries: report.length, report };
    }

    /* ── migration_invoke_module_proc (apply) ───────────────── */
    case "migration_invoke_module_proc": {
      const module = String(args.module ?? "ui_procs");
      const procName = String(args.name ?? "").trim();
      if (!procName) throw new McpError("name bắt buộc");
      const procArgs = asObj(args.args);

      const entry =
        (await getModuleProc(module, procName)) ?? (await getModuleProcByName(procName));
      if (!entry) {
        throw new McpError(`Không tìm thấy proc "${procName}" (module ${module}) trong registry`);
      }
      const t0 = Date.now();
      try {
        const result = await entry.fn(db, companyId, procArgs);
        const durationMs = Date.now() - t0;
        let out: unknown = result;
        let truncated = false;
        const json = JSON.stringify(result ?? null);
        if (json.length > 200_000) {
          out = `${json.slice(0, 200_000)}…(cắt)`;
          truncated = true;
        }
        return {
          ok: true,
          module: entry.module,
          name: entry.name,
          durationMs,
          rowCount: Array.isArray(result) ? result.length : undefined,
          truncated,
          result: out,
        };
      } catch (e) {
        return {
          ok: false,
          module: entry.module,
          name: entry.name,
          durationMs: Date.now() - t0,
          error: (e as Error).message,
        };
      }
    }

    /* ── datasource_list (read) ─────────────────────────────── */
    case "datasource_list": {
      const rows = await db
        .select()
        .from(dataSources)
        .where(eq(dataSources.companyId, companyId))
        .orderBy(dataSources.name);
      return rows.map((r) => {
        const cfg = (r.config ?? {}) as {
          baseEntityId?: string;
          relations?: unknown[];
          fields?: unknown[];
        };
        return {
          id: r.id,
          name: r.name,
          label: r.label,
          baseEntityId: cfg.baseEntityId ?? "",
          relationCount: cfg.relations?.length ?? 0,
          fieldCount: cfg.fields?.length ?? 0,
        };
      });
    }

    /* ── datasource_create_draft (apply) ────────────────────── */
    case "datasource_create_draft": {
      const dsName = String(args.name ?? "");
      const label = String(args.label ?? "");
      if (!/^[a-z][a-z0-9_]*$/.test(dsName)) {
        throw new McpError("name sai định dạng (^[a-z][a-z0-9_]*$)");
      }
      if (!label) throw new McpError("label bắt buộc");
      // Validate config qua đúng zod của datasources-router (cùng hợp đồng UI).
      const parsed = dataSourceConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new McpError(
          `config không hợp lệ: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const cfg = parsed.data;
      if (!cfg.baseEntityId) throw new McpError("config.baseEntityId bắt buộc");

      // Mọi entityId tham chiếu phải thuộc công ty — chống nối chéo tenant.
      const refIds = new Set<string>([cfg.baseEntityId]);
      for (const r of cfg.relations) refIds.add(r.targetEntityId);
      for (const a of cfg.aggregates ?? []) {
        refIds.add(a.targetEntityId);
        if (a.via) refIds.add(a.via.farEntityId);
      }
      const owned = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.companyId, companyId));
      const ownedSet = new Set(owned.map((e) => e.id));
      const alien = [...refIds].filter((id) => !ownedSet.has(id));
      if (alien.length > 0) {
        throw new McpError(`entityId không thuộc công ty: ${alien.join(", ")}`);
      }

      const [exists] = await db
        .select({ id: dataSources.id })
        .from(dataSources)
        .where(
          and(
            eq(dataSources.companyId, companyId),
            sql`lower(${dataSources.name}) = lower(${dsName})`,
          ),
        );
      if (exists) {
        if (args.overwrite === true) {
          await db
            .update(dataSources)
            .set({
              label,
              ...(args.icon ? { icon: String(args.icon) } : {}),
              config: cfg,
              updatedAt: new Date(),
            })
            .where(eq(dataSources.id, exists.id));
          return { status: "overwritten", dataSourceId: exists.id, name: dsName };
        }
        return { status: "skipped_exists", dataSourceId: exists.id, name: dsName };
      }

      const [row] = await db
        .insert(dataSources)
        .values({
          companyId,
          name: dsName,
          label,
          icon: args.icon ? String(args.icon) : null,
          config: cfg,
        })
        .returning({ id: dataSources.id });
      return { status: "created", dataSourceId: row?.id, name: dsName };
    }

    /* ── datasource_preview (read) ──────────────────────────── */
    case "datasource_preview": {
      const dsName = String(args.dataSourceName ?? "").trim();
      if (!dsName) throw new McpError("dataSourceName bắt buộc");
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 50);
      const onlyFields = (Array.isArray(args.fields) ? args.fields : []).map((s) => String(s));

      const [ds] = await db
        .select({ config: dataSources.config })
        .from(dataSources)
        .where(
          and(
            eq(dataSources.companyId, companyId),
            sql`lower(${dataSources.name}) = lower(${dsName})`,
          ),
        );
      if (!ds) throw new McpError(`DataSource '${dsName}' không tồn tại`);
      // Normalize config về DataSourceConfig (resolveList cần shape đầy đủ).
      const parsed = dataSourceConfigSchema.safeParse(ds.config ?? {});
      if (!parsed.success) throw new McpError("config DataSource không hợp lệ");
      const cfg = parsed.data as unknown as Parameters<typeof resolveList>[3];

      // Role admin → KHÔNG strip field (preview cần thấy hết để verify join).
      const out = await resolveList(db, companyId, "admin", cfg, { limit });
      const rows = onlyFields.length
        ? out.rows.map((r) => {
            const o: Record<string, unknown> = { id: (r as Record<string, unknown>).id };
            for (const f of onlyFields) o[f] = (r as Record<string, unknown>)[f];
            return o;
          })
        : out.rows;
      // Đếm null per field để lộ cột join "rỗng hàng loạt".
      const keys =
        onlyFields.length > 0
          ? onlyFields
          : [...new Set(rows.flatMap((r) => Object.keys(r as Record<string, unknown>)))];
      const nullCount: Record<string, number> = {};
      for (const k of keys) {
        nullCount[k] = rows.filter((r) => (r as Record<string, unknown>)[k] == null).length;
      }
      return { dataSource: dsName, total: out.total, sampled: rows.length, nullCount, rows };
    }

    /* ── entity_set_source (apply) ──────────────────────────── */
    case "entity_set_source": {
      const entityName = String(args.name ?? "");
      const mssqlTable = String(args.mssqlTable ?? "");
      if (!entityName || !mssqlTable) throw new McpError("name + mssqlTable bắt buộc");
      const source: Record<string, unknown> = {
        kind: "migration",
        mssqlTable,
        ...(args.connectionId ? { connectionId: String(args.connectionId) } : {}),
      };
      const updated = await db
        .update(entities)
        .set({
          meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ source })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(entities.companyId, companyId),
            sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        )
        .returning({ id: entities.id });
      if (updated.length === 0) throw new McpError(`Entity '${entityName}' không tồn tại`, -32602);
      return { ok: true, entityId: updated[0]?.id, source };
    }

    /* ── migration_skip_job_table (apply) ───────────────────── */
    case "migration_skip_job_table": {
      const jobId = String(args.jobId ?? "");
      const tableNames = Array.isArray(args.tableNames) ? args.tableNames.map(String) : [];
      if (!jobId || tableNames.length === 0) throw new McpError("jobId + tableNames bắt buộc");

      const [job] = await db
        .select({ id: migrationFullJobs.id })
        .from(migrationFullJobs)
        .where(and(eq(migrationFullJobs.id, jobId), eq(migrationFullJobs.companyId, companyId)));
      if (!job) throw new McpError(`Job '${jobId}' không tồn tại`, -32602);

      const results: Array<{ tableName: string; status: "skipped" | "not_found" }> = [];
      for (const t of tableNames) {
        const updated = await db
          .update(migrationFullJobTables)
          .set({ status: "skipped", error: null, updatedAt: new Date() })
          .where(
            and(eq(migrationFullJobTables.jobId, jobId), eq(migrationFullJobTables.tableName, t)),
          )
          .returning({ id: migrationFullJobTables.id });
        results.push({ tableName: t, status: updated.length > 0 ? "skipped" : "not_found" });
      }
      return { results };
    }

    /* ── migration_resume_full_job (apply) ──────────────────── */
    case "migration_resume_full_job": {
      if (!apiKeyCreatedBy) {
        throw new McpError("API key không có người tạo — không xác định được userId.", -32603);
      }
      const jobId = String(args.jobId ?? "");
      if (!jobId) throw new McpError("jobId bắt buộc");

      const [job] = await db
        .select({ id: migrationFullJobs.id, status: migrationFullJobs.status })
        .from(migrationFullJobs)
        .where(and(eq(migrationFullJobs.id, jobId), eq(migrationFullJobs.companyId, companyId)));
      if (!job) throw new McpError(`Job '${jobId}' không tồn tại`, -32602);
      if (job.status === "canceled") throw new McpError("Job đã canceled — không resume được");

      // failed (tạm) → pending để retry; done/skipped giữ nguyên.
      await db
        .update(migrationFullJobTables)
        .set({ status: "pending", error: null, updatedAt: new Date() })
        .where(
          and(
            eq(migrationFullJobTables.jobId, jobId),
            sql`${migrationFullJobTables.status} = 'failed'`,
          ),
        );
      await db
        .update(migrationFullJobs)
        .set({ status: "queued", completedAt: null, error: null, updatedAt: new Date() })
        .where(eq(migrationFullJobs.id, jobId));
      await enqueueMigrationJob({
        action: "full-import",
        module: jobId,
        args: {},
        userId: apiKeyCreatedBy,
        companyId,
      });
      return { jobId, status: "queued" };
    }

    /* ── migration_enable_sync (apply) ──────────────────────── */
    case "migration_enable_sync": {
      if (!apiKeyCreatedBy) {
        throw new McpError(
          "API key không có người tạo (created_by null) — không xác định được createdBy.",
          -32603,
        );
      }
      const connectionId = String(args.connectionId ?? "");
      const module = String(args.module ?? "");
      if (!connectionId || !module) throw new McpError("connectionId + module bắt buộc");
      if (!/^[a-z][a-z0-9_]*$/.test(module)) {
        throw new McpError("module sai định dạng (^[a-z][a-z0-9_]*$)");
      }
      const rawTables = Array.isArray(args.tables) ? args.tables : [];
      if (rawTables.length === 0) throw new McpError("tables bắt buộc (>=1)");
      if (rawTables.length > 200) throw new McpError("Tối đa 200 bảng mỗi module");
      const tables = rawTables.map((t) => {
        const o = asObj(t);
        const mode = ["ct", "rescan", "manual"].includes(String(o.mode))
          ? (String(o.mode) as "ct" | "rescan" | "manual")
          : ("ct" as const);
        return {
          tableName: String(o.tableName ?? ""),
          pkColumn: o.pkColumn ? String(o.pkColumn) : undefined,
          mode,
        };
      });
      const cronExpr = args.cronExpr ? String(args.cronExpr) : undefined;
      return enableModuleSyncForCompany(companyId, apiKeyCreatedBy, {
        connectionId,
        module,
        cronExpr,
        tables,
      });
    }

    /* ── migration_start_full_import (apply) ────────────────── */
    case "migration_start_full_import": {
      if (!apiKeyCreatedBy) {
        throw new McpError(
          "API key không có người tạo (created_by null) — không xác định được createdBy cho job. Tạo key mới từ tài khoản admin.",
          -32603,
        );
      }
      const connectionId = String(args.connectionId ?? "");
      if (!connectionId) throw new McpError("connectionId bắt buộc");
      const rawItems = Array.isArray(args.items) ? args.items : [];
      if (rawItems.length === 0) throw new McpError("items bắt buộc (>=1 bảng)");
      if (rawItems.length > 200) throw new McpError("Tối đa 200 bảng mỗi job");

      const items: FullJobItem[] = rawItems.map((it) => {
        const o = asObj(it);
        const entityName = String(o.entityName ?? "");
        if (!/^[a-z][a-z0-9_]*$/.test(entityName)) {
          throw new McpError(`entityName "${entityName}" sai định dạng (^[a-z][a-z0-9_]*$)`);
        }
        const fields = (Array.isArray(o.fields) ? o.fields : []).map((f) => {
          const fo = asObj(f);
          return {
            name: String(fo.name ?? ""),
            label: String(fo.label ?? fo.name ?? ""),
            type: String(fo.type ?? "text"),
          };
        });
        return {
          tableName: String(o.tableName ?? ""),
          entityName,
          label: String(o.label ?? entityName),
          fields,
        };
      });

      const targetTier = args.targetTier === "table" ? ("table" as const) : ("eav" as const);
      if (targetTier === "table" && !isHybridTablesEnabled()) {
        throw new McpError("targetTier=table cần ERP_HYBRID_TABLES=1 trên server.", -32603);
      }
      const batchSize = Math.min(Math.max(Number(args.batchSize ?? 5_000), 100), 50_000);

      const { jobId } = await createFullImportJob(db, companyId, apiKeyCreatedBy, {
        connectionId,
        items,
        batchSize,
        targetTier,
      });
      await enqueueMigrationJob({
        action: "full-import",
        module: jobId,
        args: {},
        userId: apiKeyCreatedBy,
        companyId,
      });
      return { jobId, tables: items.length, targetTier, batchSize };
    }

    default:
      throw new McpError(`Tool chưa cài đặt: ${name}`, -32601);
  }
}

/* ── JSON-RPC handler ───────────────────────────────────────── */
interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function registerMigrationMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp/migration", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasMigrationScope(auth.scopes)) {
      return reply.code(403).send({ error: "Thiếu scope migration:read" });
    }

    const body = (req.body ?? {}) as JsonRpcReq;
    const id = body.id ?? null;
    const method = body.method;

    const ok = (result: unknown) => reply.send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (method) {
        case "initialize":
          return ok({
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "erp-migration", version: "1.0.0" },
          });
        case "notifications/initialized":
          return reply.code(204).send();
        case "ping":
          return ok({});
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const name = String(p.name ?? "");
          const data = await callMigrationTool(
            db,
            auth.companyId,
            auth.scopes,
            auth.createdBy ?? null,
            name,
            p.arguments,
          );
          return ok({
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
        }
        default:
          return fail(-32601, `Method không hỗ trợ: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      console.error("[mcp/migration] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });
}
