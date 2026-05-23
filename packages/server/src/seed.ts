/* ==========================================================
   seed.ts — Nạp ERP mẫu (entity + record + page + workflow +
   agent) vào PostgreSQL. Idempotent: đối tượng đã tồn tại → bỏ qua.
   ĐA CÔNG TY: nạp vào "Công ty mặc định" (slug="default"), tạo
   công ty này nếu chưa có.
   Chạy: pnpm --filter @erp-framework/server seed
   ========================================================== */
import "./load-env"; // PHẢI đứng đầu — nạp .env trước khi db.ts đọc env
import { and, eq } from "drizzle-orm";
import {
  entities, entityRecords, pages, workflows, agents, companies,
} from "@erp-framework/db";
import { db } from "./db";

interface SeedEntity {
  name: string;
  label: string;
  icon: string;
  fields: Array<{
    name: string; label: string; type: string;
    required?: boolean; options?: string[];
  }>;
  records: Array<Record<string, unknown>>;
}

const SEED: SeedEntity[] = [
  {
    name: "khach_hang", label: "Khách hàng", icon: "Users",
    fields: [
      { name: "ten", label: "Tên", type: "text", required: true },
      { name: "email", label: "Email", type: "text" },
      { name: "dien_thoai", label: "Điện thoại", type: "text" },
      { name: "dia_chi", label: "Địa chỉ", type: "text" },
    ],
    records: [
      { ten: "Công ty Gỗ Việt", email: "lh@goviet.vn", dien_thoai: "0901234567", dia_chi: "Bình Dương" },
      { ten: "Nội thất An Phú", email: "info@anphu.vn", dien_thoai: "0912345678", dia_chi: "TP.HCM" },
    ],
  },
  {
    name: "san_pham", label: "Sản phẩm", icon: "Package",
    fields: [
      { name: "ten", label: "Tên sản phẩm", type: "text", required: true },
      { name: "ma_sp", label: "Mã SP", type: "text" },
      { name: "gia", label: "Giá", type: "number" },
      { name: "ton_kho", label: "Tồn kho", type: "number" },
    ],
    records: [
      { ten: "Bàn ăn gỗ sồi 1m6", ma_sp: "BA-016", gia: 4500000, ton_kho: 12 },
      { ten: "Ghế gỗ óc chó", ma_sp: "GH-OC", gia: 1200000, ton_kho: 48 },
    ],
  },
  {
    name: "don_hang", label: "Đơn hàng", icon: "Cart",
    fields: [
      { name: "so_don", label: "Số đơn", type: "text", required: true },
      { name: "khach", label: "Khách hàng", type: "text" },
      { name: "tong_tien", label: "Tổng tiền", type: "number" },
      { name: "trang_thai", label: "Trạng thái", type: "select",
        options: ["moi", "dang_giao", "hoan_thanh"] },
    ],
    records: [
      { so_don: "DH-2026-001", khach: "Công ty Gỗ Việt", tong_tien: 54000000, trang_thai: "dang_giao" },
      { so_don: "DH-2026-002", khach: "Nội thất An Phú", tong_tien: 12000000, trang_thai: "moi" },
    ],
  },
];

/** Lấy id "Công ty mặc định" — tạo nếu chưa có. */
async function defaultCompanyId(): Promise<string> {
  const [ex] = await db.select({ id: companies.id }).from(companies)
    .where(eq(companies.slug, "default"));
  if (ex) return ex.id;
  const [co] = await db.insert(companies)
    .values({ name: "Công ty mặc định", slug: "default" }).returning();
  if (!co) throw new Error("Không tạo được công ty mặc định");
  console.log(`✓ Công ty mặc định`);
  return co.id;
}

/** Nạp entity + record. Trả về map name → id để page tham chiếu. */
async function seedEntities(companyId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const s of SEED) {
    const [exist] = await db.select({ id: entities.id }).from(entities)
      .where(and(eq(entities.name, s.name), eq(entities.companyId, companyId)));
    if (exist) {
      ids[s.name] = exist.id;
      console.log(`• Bỏ qua entity "${s.name}" — đã tồn tại`);
      continue;
    }
    const [ent] = await db.insert(entities).values({
      companyId, name: s.name, label: s.label, icon: s.icon, fields: s.fields,
    }).returning();
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
async function seedPage(
  companyId: string,
  entityIds: Record<string, string>,
): Promise<void> {
  const name = "tong_quan";
  const [exist] = await db.select({ id: pages.id }).from(pages)
    .where(and(eq(pages.name, name), eq(pages.companyId, companyId)));
  if (exist) { console.log(`• Bỏ qua page "${name}" — đã tồn tại`); return; }
  const content = [
    { id: "k1", kind: "kpi", x: 0, y: 0, w: 3, h: 2,
      config: { label: "Đơn hàng", value: "2", trend: "+2" } },
    { id: "k2", kind: "kpi", x: 3, y: 0, w: 3, h: 2,
      config: { label: "Khách hàng", value: "2" } },
    { id: "k3", kind: "kpi", x: 6, y: 0, w: 3, h: 2,
      config: { label: "Sản phẩm", value: "2" } },
    { id: "c1", kind: "chart", x: 0, y: 2, w: 8, h: 3,
      config: { kind: "bar", title: "Doanh số theo tháng" } },
    { id: "l1", kind: "list", x: 8, y: 2, w: 4, h: 3,
      config: { entity: entityIds.don_hang ?? "" } },
  ];
  await db.insert(pages).values({
    companyId, name, label: "Tổng quan kinh doanh", icon: "BarChart", content,
  });
  console.log(`✓ Page "Tổng quan kinh doanh"`);
}

/** Workflow mẫu — trigger thủ công, graph rỗng để designer điền sau. */
async function seedWorkflow(companyId: string): Promise<void> {
  const name = "Duyệt đơn hàng lớn";
  const [exist] = await db.select({ id: workflows.id }).from(workflows)
    .where(and(eq(workflows.name, name), eq(workflows.companyId, companyId)));
  if (exist) { console.log(`• Bỏ qua workflow "${name}" — đã tồn tại`); return; }
  await db.insert(workflows).values({
    companyId, name, triggerType: "manual", isActive: true,
    graph: { nodes: [], edges: [] },
  });
  console.log(`✓ Workflow "${name}"`);
}

/** Agent mẫu — trợ lý bán hàng. */
async function seedAgent(companyId: string): Promise<void> {
  const name = "Trợ lý bán hàng";
  const [exist] = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.name, name), eq(agents.companyId, companyId)));
  if (exist) { console.log(`• Bỏ qua agent "${name}" — đã tồn tại`); return; }
  await db.insert(agents).values({
    companyId, name, model: "claude-sonnet-4-6",
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

async function seed(): Promise<void> {
  const companyId = await defaultCompanyId();
  const ids = await seedEntities(companyId);
  await seedPage(companyId, ids);
  await seedWorkflow(companyId);
  await seedAgent(companyId);
  console.log("Seed xong.");
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed lỗi:", e);
    process.exit(1);
  });
