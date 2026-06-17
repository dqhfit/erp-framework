/* ==========================================================
   menu-node-label — nhãn cho lookup chọn mục menu DQHF (legacy_menu_map).
   Thêm "cấp N" + tên mục cha để dễ nhận biết (nhiều mục trùng tên ở các cấp
   khác nhau). Dùng chung cho mọi bộ chọn node menu.
   ========================================================== */
import type { LegacyPageBinding } from "@erp-framework/client";

export type MenuNodeLite = Pick<
  LegacyPageBinding,
  "sourceCode" | "name" | "level" | "parentCode" | "pageId" | "pageLabel" | "pageName"
>;

/** Map sourceCode → node (để tra cha). */
export function buildNodeIndex(nodes: MenuNodeLite[]): Map<string, MenuNodeLite> {
  return new Map(nodes.map((n) => [n.sourceCode, n]));
}

/** Nhãn 1 mục menu: "Tên · mã <slug> · cấp N · trong: <cha>" (+ "hiện: <trang>"
 *  nếu showAssigned). Hiện đủ tên/mã/cấp/cha để phân biệt mục trùng tên. */
export function menuNodeLabel(
  node: MenuNodeLite,
  byCode: Map<string, MenuNodeLite>,
  opts: { showAssigned?: boolean } = {},
): string {
  const name = node.name || node.sourceCode;
  const lvl = node.level ?? byCode.size; // fallback: nếu thiếu level
  const parentName = node.parentCode ? byCode.get(node.parentCode)?.name : undefined;
  let label = `${name}  ·  mã ${node.sourceCode}  ·  cấp ${lvl}`;
  if (parentName) label += ` · trong: ${parentName}`;
  if (opts.showAssigned && node.pageId) {
    label += `  —  hiện: ${node.pageLabel || node.pageName || "?"}`;
  }
  return label;
}
