/* ==========================================================
   seed.ts — Nạp ERP mẫu (entity + record + page + workflow +
   agent) vào PostgreSQL. Idempotent: đối tượng đã tồn tại → bỏ qua.
   ĐA CÔNG TY: nạp vào "Công ty mặc định" (slug="default"), tạo
   công ty này nếu chưa có.
   Chạy: pnpm --filter @erp-framework/server seed
   ========================================================== */
import "./load-env"; // PHẢI đứng đầu — nạp .env trước khi db.ts đọc env
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { entities, entityRecords, pages, workflows, agents, companies } from "@erp-framework/db";
import { db } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
/* docs/CEO/ chứa 7 file mô tả persona Giám đốc điều hành. Anchor
   theo vị trí seed.ts (packages/server/src) → repo root. */
const CEO_DOCS_DIR = join(__dirname, "..", "..", "..", "docs", "CEO");
const MEMORY_FILES = [
  "IDENTITY",
  "SOUL",
  "USER",
  "TOOLS",
  "AGENTS",
  "HEARTBEAT",
  "BOOTSTRAP",
] as const;

interface SeedEntity {
  name: string;
  label: string;
  icon: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
  }>;
  records: Array<Record<string, unknown>>;
}

/* Chỉ seed 1 entity mẫu khi redeploy — đủ minh hoạ low-code, tránh
   nhồi dữ liệu demo vào tenant thật. Thêm entity khác thì người dùng
   tự tạo qua designer. */
const SEED: SeedEntity[] = [
  {
    name: "khach_hang",
    label: "Khách hàng",
    icon: "Users",
    fields: [
      { name: "ten", label: "Tên", type: "text", required: true },
      { name: "email", label: "Email", type: "text" },
      { name: "dien_thoai", label: "Điện thoại", type: "text" },
      { name: "dia_chi", label: "Địa chỉ", type: "text" },
    ],
    records: [
      {
        ten: "Công ty Gỗ Việt",
        email: "lh@goviet.vn",
        dien_thoai: "0901234567",
        dia_chi: "Bình Dương",
      },
      {
        ten: "Nội thất An Phú",
        email: "info@anphu.vn",
        dien_thoai: "0912345678",
        dia_chi: "TP.HCM",
      },
    ],
  },
  {
    // Danh mục "Hệ hàng" — port từ form cũ frmCaiDatHeSoHeHang (bảng tr_hehang).
    // Bỏ cột id integer của hệ cũ; framework tự cấp record id (uuid).
    name: "tr_hehang",
    label: "Hệ hàng",
    icon: "Layers",
    fields: [
      { name: "tenhh", label: "Tên hệ hàng", type: "text", required: true },
      { name: "khachhang", label: "Khách hàng", type: "text" },
      { name: "heso", label: "Hệ số", type: "number" },
      { name: "ghichu", label: "Ghi chú", type: "text" },
    ],
    records: [
      { tenhh: "Hệ hàng A", khachhang: "Công ty Gỗ Việt", heso: 1.0, ghichu: "Dòng tiêu chuẩn" },
      { tenhh: "Hệ hàng B", khachhang: "Nội thất An Phú", heso: 1.2, ghichu: "Dòng cao cấp" },
      { tenhh: "Hệ hàng C", khachhang: "", heso: 0.9, ghichu: "" },
    ],
  },
];

/** Lấy id "Công ty mặc định" — tạo nếu chưa có. */
async function defaultCompanyId(): Promise<string> {
  const [ex] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, "default"));
  if (ex) return ex.id;
  const [co] = await db
    .insert(companies)
    .values({ name: "Công ty mặc định", slug: "default" })
    .returning();
  if (!co) throw new Error("Không tạo được công ty mặc định");
  console.log(`✓ Công ty mặc định`);
  return co.id;
}

/** Nạp entity + record. Trả về map name → id để page tham chiếu. */
async function seedEntities(companyId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const s of SEED) {
    const [exist] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.name, s.name), eq(entities.companyId, companyId)));
    if (exist) {
      ids[s.name] = exist.id;
      console.log(`• Bỏ qua entity "${s.name}" — đã tồn tại`);
      continue;
    }
    const [ent] = await db
      .insert(entities)
      .values({
        companyId,
        name: s.name,
        label: s.label,
        icon: s.icon,
        fields: s.fields,
      })
      .returning();
    if (!ent) throw new Error(`Không tạo được entity ${s.name}`);
    ids[s.name] = ent.id;
    for (const r of s.records) {
      await db.insert(entityRecords).values({ companyId, entityId: ent.id, data: r });
    }
    console.log(`✓ Entity "${s.label}" + ${s.records.length} record`);
  }
  return ids;
}

/** Trang dashboard mẫu — list trỏ vào entity Đơn hàng. */
async function seedPage(companyId: string, entityIds: Record<string, string>): Promise<void> {
  const name = "tong_quan";
  const [exist] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.name, name), eq(pages.companyId, companyId)));
  if (exist) {
    console.log(`• Bỏ qua page "${name}" — đã tồn tại`);
    return;
  }
  const content = [
    {
      id: "k1",
      kind: "kpi",
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Khách hàng", value: "2", trend: "+2" },
    },
    {
      id: "c1",
      kind: "chart",
      x: 0,
      y: 2,
      w: 8,
      h: 3,
      config: { kind: "bar", title: "Doanh số theo tháng" },
    },
    {
      id: "l1",
      kind: "list",
      x: 8,
      y: 2,
      w: 4,
      h: 3,
      config: { entity: entityIds.khach_hang ?? "" },
    },
  ];
  await db.insert(pages).values({
    companyId,
    name,
    label: "Tổng quan kinh doanh",
    icon: "BarChart",
    content,
  });
  console.log(`✓ Page "Tổng quan kinh doanh"`);
}

/** Trang "Danh mục" quản lý Hệ hàng (tr_hehang): Thêm (form) + Sửa (list
 *  editable inline) + Xóa (action nhúng theo dòng đang chọn) + Xuất Excel
 *  (.xlsx — nút có sẵn trong DataGrid). Idempotent: đã có → bỏ qua. */
async function seedDanhMuc(
  companyId: string,
  entityIds: Record<string, string>,
): Promise<void> {
  const name = "danh_muc";
  const [exist] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.name, name), eq(pages.companyId, companyId)));
  if (exist) {
    console.log(`• Bỏ qua page "${name}" — đã tồn tại`);
    return;
  }
  const entId = entityIds.tr_hehang ?? "";
  // Key page-state lưu id dòng đang chọn → nút Xóa đọc lại để xoá đúng record.
  const SEL = "hehang_sel";
  const cols = ["tenhh", "khachhang", "heso", "ghichu"];
  const content = [
    {
      id: "frm_them",
      kind: "form",
      x: 0,
      y: 0,
      w: 12,
      h: 3,
      config: { entity: entId, title: "Thêm hệ hàng", fields: cols },
    },
    {
      id: "ds_hehang",
      kind: "list",
      x: 0,
      y: 3,
      w: 12,
      h: 8,
      config: {
        entity: entId,
        title: "Danh mục hệ hàng",
        fields: cols,
        // Sửa: double-click ô để sửa inline, lưu thẳng về record.
        editable: true,
        // Click dòng → lưu id vào page-state[SEL] cho nút Xóa.
        selectionStateKey: SEL,
        // Nút Xóa nhúng trên thanh công cụ list — xoá dòng đang chọn (có confirm).
        embeddedActions: [
          {
            id: "act_xoa",
            label: "Xóa",
            icon: "Trash",
            variant: "danger",
            requireConfirm: true,
            confirmTitle: "Xác nhận xóa",
            confirmMessage: "Xóa hệ hàng đang chọn? Hãy chọn 1 dòng trước khi xóa.",
            steps: [
              {
                id: "s_xoa",
                kind: "delete-record",
                recordIdBinding: { source: "state", key: SEL },
                invalidateEntities: [entId],
              },
            ],
          },
        ],
      },
    },
  ];
  await db.insert(pages).values({
    companyId,
    name,
    label: "Danh mục",
    icon: "Layers",
    content,
  });
  console.log(`✓ Page "Danh mục" (Hệ hàng: thêm/sửa/xóa/xuất Excel)`);
}

/** Workflow mẫu — trigger thủ công, graph rỗng để designer điền sau. */
async function seedWorkflow(companyId: string): Promise<void> {
  const name = "Duyệt đơn hàng lớn";
  const [exist] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.name, name), eq(workflows.companyId, companyId)));
  if (exist) {
    console.log(`• Bỏ qua workflow "${name}" — đã tồn tại`);
    return;
  }
  await db.insert(workflows).values({
    companyId,
    name,
    triggerType: "manual",
    isActive: true,
    graph: { nodes: [], edges: [] },
  });
  console.log(`✓ Workflow "${name}"`);
}

/** Agent mẫu — trợ lý bán hàng. */
async function seedAgent(companyId: string): Promise<void> {
  const name = "Trợ lý bán hàng";
  const [exist] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.name, name), eq(agents.companyId, companyId)));
  if (exist) {
    console.log(`• Bỏ qua agent "${name}" — đã tồn tại`);
    return;
  }
  await db.insert(agents).values({
    companyId,
    name,
    model: "claude-sonnet-4-6",
    config: {
      name,
      model: "claude-sonnet-4-6",
      systemPrompt:
        "Bạn là trợ lý bán hàng. Trả lời tiếng Việt, ngắn gọn.\n" +
        "Trước khi tạo/sửa dữ liệu, hãy xác nhận lại với người dùng.",
      temperature: 0.7,
      tools: [],
      // 7 file memory — set 3 file có nội dung mẫu (showcase); còn lại
      // bỏ trống → server fallback default template lúc runtime.
      memory: {
        IDENTITY:
          `# Trợ lý bán hàng\n\nTôi là **Trợ lý bán hàng** — trợ lý ERP ` +
          `chuyên về đơn hàng, khách hàng, sản phẩm.\n\nVai trò chính:\n` +
          `- Tóm tắt + tra cứu đơn hàng.\n` +
          `- Gợi ý up-sell / cross-sell dựa trên lịch sử.\n` +
          `- Cảnh báo đơn hàng có vấn đề (chậm giao, công nợ…).\n`,
        SOUL:
          `# Tinh thần\n\n` +
          `- Lễ phép với khách. Cứng rắn với gian lận.\n` +
          `- Luôn xác nhận trước khi thay đổi đơn hàng.\n` +
          `- Học hỏi từ pattern lặp lại — ghi vào USER.md.\n`,
        USER:
          `# Người dùng\n\n(Chưa thu thập thông tin. Mỗi lần phát hiện ` +
          `sở thích/ngữ cảnh mới → tự gọi memory_remember.)\n`,
      },
    },
  });
  console.log(`✓ Agent "${name}"`);
}

/** Đọc 7 file memory từ docs/CEO/. Thiếu file → bỏ qua (server
   fallback default template lúc runtime). */
function loadCEOMemory(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of MEMORY_FILES) {
    try {
      out[f] = readFileSync(join(CEO_DOCS_DIR, `${f}.md`), "utf8");
    } catch {
      console.log(`  (CEO: thiếu ${f}.md — bỏ qua, dùng default)`);
    }
  }
  return out;
}

/** Agent CEO mặc định — đứng đầu org chart (managerId = null). Đọc
   persona từ docs/CEO/*.md. Idempotent: nếu CEO đã có nhưng memory
   rỗng (vd seed cũ trước khi có tính năng) → tự backfill. */
async function seedCEO(companyId: string): Promise<void> {
  const name = "CEO";
  const memory = loadCEOMemory();
  const memCount = Object.keys(memory).length;

  const [exist] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.name, name), eq(agents.companyId, companyId)));
  if (exist) {
    const cfg = (exist.config ?? {}) as { memory?: Record<string, unknown> };
    const have = cfg.memory ? Object.keys(cfg.memory).length : 0;
    if (have > 0) {
      console.log(`• Bỏ qua agent "${name}" — đã có ${have} memory file`);
      return;
    }
    // CEO tồn tại nhưng memory rỗng → backfill từ docs/CEO/.
    await db
      .update(agents)
      .set({
        config: { ...(exist.config as object), memory },
        updatedAt: new Date(),
      })
      .where(eq(agents.id, exist.id));
    console.log(`✓ Agent "${name}" — backfill ${memCount}/7 memory file`);
    return;
  }

  await db.insert(agents).values({
    companyId,
    name,
    model: "claude-sonnet-4-6",
    config: {
      name,
      model: "claude-sonnet-4-6",
      systemPrompt:
        "Bạn là Giám đốc điều hành (CEO) của công ty. Tuân theo IDENTITY/" +
        "SOUL/USER trong memory. Khi xung đột giữa các file, SOUL.md ưu " +
        "tiên cao nhất. Trước khi quyết định lớn, đọc lại BOOTSTRAP.md.",
      temperature: 0.5, // CEO thận trọng hơn assistant thông thường.
      tools: [],
      memory,
    },
  });
  console.log(`✓ Agent "${name}" — CEO mới với ${memCount}/7 file memory`);
}

async function seed(): Promise<void> {
  const companyId = await defaultCompanyId();
  const ids = await seedEntities(companyId);
  await seedPage(companyId, ids);
  await seedDanhMuc(companyId, ids);
  await seedWorkflow(companyId);
  await seedAgent(companyId);
  await seedCEO(companyId);
  console.log("Seed xong.");
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed lỗi:", e);
    process.exit(1);
  });
