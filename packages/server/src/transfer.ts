/* ==========================================================
   transfer.ts — Xuất/nhập trọn cấu hình low-code: entity + page
   + workflow + agent. Dùng để chia sẻ "ERP mẫu" giữa các bản
   triển khai. Plugin là code (src/plugins/) nên không nằm trong
   gói này.

   ĐA CÔNG TY: xuất/nhập theo company_id. Import = upsert theo id
   TRONG phạm vi công ty; nếu id đã tồn tại ở công ty KHÁC thì sinh
   id mới (tránh ghi đè dữ liệu công ty khác).
   ========================================================== */
import { eq } from "drizzle-orm";
import { entities, pages, workflows, agents } from "@erp-framework/db";
import type { DB } from "./db";

export interface Bundle {
  version: number;
  exportedAt: string;
  entities: unknown[];
  pages: unknown[];
  workflows: unknown[];
  agents: unknown[];
}

export async function exportBundle(db: DB, companyId: string): Promise<Bundle> {
  const [e, p, w, a] = await Promise.all([
    db.select().from(entities).where(eq(entities.companyId, companyId)),
    db.select().from(pages).where(eq(pages.companyId, companyId)),
    db.select().from(workflows).where(eq(workflows.companyId, companyId)),
    db.select().from(agents).where(eq(agents.companyId, companyId)),
  ]);
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    entities: e, pages: p, workflows: w, agents: a,
  };
}

type Row = Record<string, unknown>;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

/* Từ companyId của bản ghi đã tồn tại (nếu có) → quyết định:
   - undefined  : chưa tồn tại → INSERT giữ nguyên id.
   - cùng công ty: UPDATE.
   - công ty khác: INSERT nhưng để DB sinh id mới. */
function decide(
  existing: string | undefined,
  companyId: string,
): { mode: "update" | "insert"; keepId: boolean } {
  if (existing === undefined) return { mode: "insert", keepId: true };
  if (existing === companyId) return { mode: "update", keepId: true };
  return { mode: "insert", keepId: false };
}

export async function importBundle(
  db: DB,
  companyId: string,
  b: Partial<Bundle>,
): Promise<Record<string, number>> {
  let ce = 0, cp = 0, cw = 0, ca = 0;

  for (const r of (b.entities ?? []) as Row[]) {
    if (!r.id || !r.name) continue;
    const id = str(r.id);
    const set = {
      name: str(r.name), label: str(r.label, str(r.name)),
      icon: typeof r.icon === "string" ? r.icon : null,
      fields: r.fields ?? [], meta: r.meta ?? {},
    };
    const [ex] = await db.select({ companyId: entities.companyId })
      .from(entities).where(eq(entities.id, id));
    const d = decide(ex?.companyId, companyId);
    if (d.mode === "update") {
      await db.update(entities).set({ ...set, updatedAt: new Date() })
        .where(eq(entities.id, id));
    } else {
      await db.insert(entities)
        .values({ ...(d.keepId ? { id } : {}), companyId, ...set });
    }
    ce++;
  }
  for (const r of (b.pages ?? []) as Row[]) {
    if (!r.id || !r.name) continue;
    const id = str(r.id);
    const set = {
      name: str(r.name), label: str(r.label, str(r.name)),
      icon: typeof r.icon === "string" ? r.icon : null, content: r.content ?? {},
    };
    const [ex] = await db.select({ companyId: pages.companyId })
      .from(pages).where(eq(pages.id, id));
    const d = decide(ex?.companyId, companyId);
    if (d.mode === "update") {
      await db.update(pages).set({ ...set, updatedAt: new Date() })
        .where(eq(pages.id, id));
    } else {
      await db.insert(pages)
        .values({ ...(d.keepId ? { id } : {}), companyId, ...set });
    }
    cp++;
  }
  for (const r of (b.workflows ?? []) as Row[]) {
    if (!r.id || !r.name) continue;
    const id = str(r.id);
    const tt = str(r.triggerType, "manual");
    const set = {
      name: str(r.name),
      triggerType: (["manual", "webhook", "cron", "entity_changed"].includes(tt)
        ? tt : "manual") as "manual" | "webhook" | "cron" | "entity_changed",
      graph: r.graph ?? { nodes: [], edges: [] },
      publishedGraph: r.publishedGraph ?? null,
      isActive: r.isActive === true,
    };
    const [ex] = await db.select({ companyId: workflows.companyId })
      .from(workflows).where(eq(workflows.id, id));
    const d = decide(ex?.companyId, companyId);
    if (d.mode === "update") {
      await db.update(workflows).set({ ...set, updatedAt: new Date() })
        .where(eq(workflows.id, id));
    } else {
      await db.insert(workflows)
        .values({ ...(d.keepId ? { id } : {}), companyId, ...set });
    }
    cw++;
  }
  for (const r of (b.agents ?? []) as Row[]) {
    if (!r.id || !r.name) continue;
    const id = str(r.id);
    const set = {
      name: str(r.name), model: str(r.model, "claude-sonnet-4-6"),
      config: r.config ?? {},
    };
    const [ex] = await db.select({ companyId: agents.companyId })
      .from(agents).where(eq(agents.id, id));
    const d = decide(ex?.companyId, companyId);
    if (d.mode === "update") {
      await db.update(agents).set({ ...set, updatedAt: new Date() })
        .where(eq(agents.id, id));
    } else {
      await db.insert(agents)
        .values({ ...(d.keepId ? { id } : {}), companyId, ...set });
    }
    ca++;
  }
  return { entities: ce, pages: cp, workflows: cw, agents: ca };
}
