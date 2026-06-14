/* ==========================================================
   scaffold-menu.mts — Sinh page DRAFT THEO MENU DQHF (legacy_menu_map),
   thay vì theo module/forms.yaml. 3 nguyên tắc (feedback 2026-06-14):
     1. Tạo trang theo menu: walk legacy_menu_map, form-node level-3 (win_id
        frm*) → page; phân cấp parent_code = điều hướng.
     2. Form trùng theo phân quyền/entity → CHUNG 1 page (dedup theo bộ
        entity của form).
     3. Mang NÚT form DQHF sang: buttons (forms.yaml) + menu con bbi/btn
        thành embeddedActions thật (map caption sang action kind).

   Pilot: 1 nhánh level-1 (argv[2] = source_code level-1, vd 'G05').
   Mặc định PREVIEW (ghi JSON). --apply gọi page_create_draft.

   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/scaffold-menu.mts <level1_code> [--apply]
   ========================================================== */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const UI_DIR = join(ERP_ROOT, "migration-plan/ui");
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
const ROOT_CODE = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!KEY || !ROOT_CODE) {
  console.error("Dùng: MIGRATION_MCP_KEY=... scaffold-menu.mts <level1_code> [--apply]");
  process.exit(1);
}

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await mcp<{ rows: T[] }>("migration_query_readonly", { sql })).rows ?? [];
}

/* ── Index form từ MỌI forms.yaml ── */
interface Btn { control: string; caption: string }
interface FormRec {
  form: string;
  title: string;
  inScope?: boolean;
  entities?: string[];
  grid?: { columns?: Array<{ field: string; header: string }> };
  buttons?: Btn[];
  procs?: string[];
}
const formByName = new Map<string, FormRec>();
for (const file of readdirSync(UI_DIR).filter((f) => f.endsWith(".forms.yaml"))) {
  const doc = YAML.parse(readFileSync(join(UI_DIR, file), "utf8")) as { forms?: FormRec[] };
  for (const f of doc.forms ?? []) if (!formByName.has(f.form)) formByName.set(f.form, f);
}

/* ── Map caption nút DQHF → action step ── */
const norm = (s: string) => s.toLowerCase().trim();
function mapButton(b: Btn, entityId: string, title: string): Record<string, unknown> | null {
  const c = norm(b.caption);
  const mk = (id: string, label: string, icon: string, variant: string, steps: unknown[]) => ({ id, label, icon, variant, steps });
  if (/(^| )(thêm|them|mới|moi|tạo|tao|add|new)( |$)/.test(c))
    return mk("act_add", b.caption, "Plus", "primary", [{ id: "s", kind: "open-popup", popupMode: "form", entity: entityId, title: `${b.caption} — ${title}`, saveOutputTo: "newRec" }]);
  if (/(sửa|sua|cập nhật|cap nhat|edit|update)/.test(c))
    return mk("act_edit", b.caption, "Pencil", "default", [{ id: "s", kind: "open-popup", popupMode: "form", entity: entityId, title: `${b.caption} — ${title}`, recordIdBinding: { source: "state", key: "sel" } }]);
  if (/(xem|chi tiết|chi tiet|view|detail)/.test(c))
    return mk("act_view", b.caption, "Eye", "default", [{ id: "s", kind: "open-popup", popupMode: "detail", entity: entityId, title, recordIdBinding: { source: "state", key: "sel" } }]);
  if (/(xoá|xoa|xóa|delete|remove)/.test(c))
    return mk("act_delete", b.caption, "Trash2", "danger", [
      { id: "s1", kind: "confirm", title: b.caption, message: "Xác nhận xoá bản ghi đang chọn?", danger: true },
      { id: "s2", kind: "delete-record", recordIdBinding: { source: "state", key: "sel" }, invalidateEntities: [entityId] },
    ]);
  if (/(duyệt|duyet|phê duyệt|phe duyet|approve|xác nhận|xac nhan)/.test(c))
    return mk("act_approve", b.caption, "Check", "default", [{ id: "s", kind: "confirm", title: b.caption, message: `${b.caption}?` }]);
  if (/(in |in$|print)/.test(c))
    return mk("act_print", b.caption, "Printer", "default", [{ id: "s", kind: "set-state", key: "__print", value: true }]);
  if (/(xuất|xuat|export|excel)/.test(c))
    return mk("act_export", b.caption, "Download", "default", [{ id: "s", kind: "set-state", key: "__export", value: true }]);
  // Lưu/Đóng/Thoát/Tìm... = form-internal/nav → bỏ khỏi action bar list.
  return null;
}

interface MenuNode { source_code: string; parent_code: string | null; name: string; level: number; win_id: string | null; sort: number }

async function main() {
  const nodes = await query<MenuNode>(
    `SELECT source_code, parent_code, name, level, win_id, sort FROM legacy_menu_map ORDER BY level, sort`,
  );
  const byParent = new Map<string, MenuNode[]>();
  for (const n of nodes) {
    const k = n.parent_code ?? "__root";
    (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(n);
  }
  // Thu thập form-node level-3 dưới cây ROOT_CODE.
  const formNodes: MenuNode[] = [];
  const walk = (code: string) => {
    for (const child of byParent.get(code) ?? []) {
      if (child.win_id && /^frm/i.test(child.win_id)) formNodes.push(child);
      walk(child.source_code);
    }
  };
  walk(ROOT_CODE);
  console.log(`Nhánh ${ROOT_CODE}: ${formNodes.length} form-node.`);

  // entity_list để map tên→id + field set (chọn entity chính theo grid-match).
  const ents = await mcp<Array<{ id: string; name: string }>>("entity_list", {});
  const entIdByName = new Map(ents.map((e) => [e.name.toLowerCase(), e.id]));
  const fieldRows = await query<{ name: string; fcsv: string }>(
    `SELECT name, COALESCE((SELECT string_agg(lower(f->>'name'), ',') FROM jsonb_array_elements(fields) f), '') AS fcsv FROM entities`,
  );
  const fieldsByEntity = new Map(fieldRows.map((r) => [r.name.toLowerCase(), new Set((r.fcsv ?? "").split(",").filter(Boolean))]));

  // Nút ribbon từ MENU: child bbi/btn của 1 form-node (name = caption).
  const menuBtnByForm = new Map<string, string[]>(); // form source_code → [caption]
  for (const fn of formNodes) {
    const caps = (byParent.get(fn.source_code) ?? [])
      .filter((c) => c.win_id && /^(bbi|btn)/i.test(c.win_id))
      .map((c) => c.name.replace(/ - (bbi|btn)\w+$/i, "").trim());
    if (caps.length) menuBtnByForm.set(fn.source_code, caps);
  }

  // Dedup theo bộ entity (form cùng entities = 1 page).
  const clusters = new Map<string, { menuNodes: MenuNode[]; forms: FormRec[]; entities: string[]; menuBtns: Set<string> }>();
  for (const mn of formNodes) {
    const fr = formByName.get(mn.win_id ?? "");
    if (!fr || !(fr.entities?.length)) continue;
    const key = [...fr.entities].sort().join(",");
    const c = clusters.get(key) ?? { menuNodes: [], forms: [], entities: fr.entities, menuBtns: new Set<string>() };
    c.menuNodes.push(mn);
    if (!c.forms.find((x) => x.form === fr.form)) c.forms.push(fr);
    for (const b of menuBtnByForm.get(mn.source_code) ?? []) c.menuBtns.add(b);
    clusters.set(key, c);
  }
  console.log(`menu-driven: ${clusters.size} page (dedup theo entity)\n`);

  const outDir = join(UI_DIR, "pages-menu", ROOT_CODE);
  mkdirSync(outDir, { recursive: true });
  let made = 0;
  for (const [key, c] of clusters) {
    // Form đại diện = nhiều cột grid nhất.
    const rep = c.forms.reduce((a, b) => ((b.grid?.columns?.length ?? 0) > (a.grid?.columns?.length ?? 0) ? b : a));
    const gridCols = [...new Set((rep.grid?.columns ?? []).map((x) => x.field))].slice(0, 16);
    // Entity CHÍNH = phủ nhiều cột grid nhất (không phải entities[0] alphabet —
    // tránh lấy lookup/context tr_site/tr_hehang làm bảng chính).
    let primary = c.entities[0];
    let bestHit = -1;
    for (const e of c.entities) {
      const fset = fieldsByEntity.get(e.toLowerCase()) ?? new Set<string>();
      const hit = gridCols.filter((g) => fset.has(g)).length;
      if (hit > bestHit) {
        bestHit = hit;
        primary = e;
      }
    }
    const primaryId = entIdByName.get(primary.toLowerCase());
    if (!primaryId) continue;
    const title = c.menuNodes[0].name || rep.title || rep.form;

    // Nút: menu ribbon (bbi/btn) + buttons Designer.cs, map → action (dedup id).
    const allBtns: Btn[] = [
      ...[...c.menuBtns].map((cap) => ({ control: "menu", caption: cap })),
      ...c.forms.flatMap((f) => f.buttons ?? []).filter((b) => b.caption),
    ];
    const actions: Record<string, unknown>[] = [];
    const seenAct = new Set<string>();
    for (const b of allBtns) {
      const a = mapButton(b, primaryId, title);
      if (a && !seenAct.has(a.id as string)) {
        seenAct.add(a.id as string);
        actions.push(a);
      }
    }
    // Luôn có Thêm/Xem mặc định nếu form không khai báo.
    if (!seenAct.has("act_add")) actions.unshift({ id: "act_add", label: "Thêm", icon: "Plus", variant: "primary", steps: [{ id: "s", kind: "open-popup", popupMode: "form", entity: primaryId, title: `Thêm — ${title}`, saveOutputTo: "newRec" }] });

    const pageName = `dq_${ROOT_CODE.toLowerCase()}_${rep.form.replace(/^frm_?/i, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 60);
    const page = {
      name: pageName,
      label: title,
      content: [
        {
          id: "w_list",
          kind: "list",
          x: 0, y: 0, w: 12, h: 10,
          config: { entity: primaryId, title, fields: gridCols, selectionStateKey: "sel", pageSize: 25, editable: true, embeddedActions: actions },
        },
      ],
      _menuCodes: c.menuNodes.map((m) => m.source_code),
    };
    writeFileSync(join(outDir, `${pageName}.json`), JSON.stringify(page, null, 1), "utf8");
    made++;
    console.log(`${pageName} — "${title}" [${c.menuNodes.length} menu-node, entity ${primary}]`);
    console.log(`    nút: ${actions.map((a) => a.label).join(", ")}`);
    if (APPLY) {
      // overwrite=false: CHỈ tạo page MỚI cho form chưa port; page đã tồn tại
      // (published/draft đã wire) bị bỏ qua — KHÔNG reset trang đã làm.
      const r = await mcp<{ status: string }>("page_create_draft", { name: page.name, label: page.label, content: page.content, overwrite: false });
      console.log(`    → ${r.status}`);
    }
  }
  console.log(`\n${APPLY ? "Tạo" : "Preview"} ${made} page (JSON: ${outDir})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
