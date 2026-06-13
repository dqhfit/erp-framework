/* Tạo DataSource ds_tonkho_sum_material — join tr_tonkho_sum ⋈ tr_material
   (INNER theo mavt), thay 3 proc đọc TR_TONKHO_SUM_GETALL2/GETALL3/GETBYPRICE.
   3 use-case khác nhau = 3 widget filter (makho / soluong range / xoa) trên
   CÙNG 1 DataSource — đúng nguyên tắc DataSource-first.
   Node thuần, key đọc từ ~/.claude.json. Idempotent (skip nếu trùng tên). */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
const KEY =
  cfg.projects["D:/code/cowok/Apps/erp-framework"].mcpServers["erp-feedback"].headers["X-API-Key"];
const URL = "https://erp.vfmgroup.vn/mcp/migration";

const TONKHO = "e998bee3-c822-472a-8406-b80cafa37056";
const MATERIAL = "b84aebbd-3f2f-4735-8409-202b679a8044";

// Projection: union field 3 proc. base = tr_tonkho_sum, mat = tr_material.
const baseFields = [
  ["mavt", "Mã vật tư", "text"],
  ["makho", "Mã kho", "text"],
  ["soluong", "Số lượng", "number"],
  ["soluong_toithieu", "SL tối thiểu", "number"],
  ["ghichu", "Ghi chú", "text"],
];
const matFields = [
  ["mota", "Mô tả", "text"],
  ["quycach", "Quy cách", "text"],
  ["mausac", "Màu sắc", "text"],
  ["dvt", "ĐVT", "text"],
  ["nhom", "Nhóm", "text"],
  ["van_mat1", "Vân mặt 1", "text"],
  ["van_mat2", "Vân mặt 2", "text"],
  ["tieuchuan", "Tiêu chuẩn", "text"],
  ["van_tieuchuan", "Vân tiêu chuẩn", "text"],
  ["soluong1kg", "Số lượng/1kg", "number"],
  ["dacdiem", "Đặc điểm", "text"],
  ["dayy", "Dày", "text"],
  ["rong", "Rộng", "text"],
  ["dai", "Dài", "text"],
  ["dongia", "Đơn giá", "currency"],
  ["loaitien", "Loại tiền", "text"],
  ["mancc", "Mã NCC", "text"],
  ["tenncc", "Tên NCC", "text"],
  ["xoa", "Đã xoá", "text"],
];

const fields = [
  ...baseFields.map(([k, label, type]) => ({
    key: k,
    sourceRelationId: "base",
    sourceField: k,
    label,
    type,
  })),
  ...matFields.map(([k, label, type]) => ({
    key: k === "mavt" ? "mat_mavt" : k, // tránh trùng key với base.mavt
    sourceRelationId: "mat",
    sourceField: k,
    label,
    type,
  })),
];

const config = {
  baseEntityId: TONKHO,
  relations: [
    {
      id: "mat",
      alias: "mat",
      fromRelationId: null,
      fromField: "mavt",
      toField: "mavt",
      targetEntityId: MATERIAL,
      joinKind: "inner", // proc gốc INNER JOIN — tồn kho không có vật tư bị loại
    },
  ],
  fields,
  // KHÔNG hard-code baseFilters xoa='N' — GETALL3 không lọc xoa; để widget
  // tự áp loadFilters (makho / soluong>< / xoa='N') theo từng use-case.
  sort: { key: "mota", dir: "asc" }, // GETALL3 ORDER BY B.mota
};

let rpc = 0;
async function mcp(name, args) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const t = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) throw new Error(t);
  return JSON.parse(t);
}

const out = await mcp("datasource_create_draft", {
  name: "ds_tonkho_sum_material",
  label: "Tồn kho + Vật tư",
  icon: "Package",
  config,
});
console.log("DS:", JSON.stringify(out));
