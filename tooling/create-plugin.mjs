#!/usr/bin/env node
/* ==========================================================
   create-plugin.mjs — scaffold một plugin mới cho ERP Framework.
   Dùng:  pnpm new:plugin <tên-plugin>
   Tạo file src/plugins/<slug>.ts; loader (src/plugins/index.ts)
   tự nạp khi app khởi động — không cần sửa chỗ nào khác.
   ========================================================== */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rawName = process.argv[2];
if (!rawName) {
  console.error("Dùng: pnpm new:plugin <tên-plugin>");
  console.error("Ví dụ: pnpm new:plugin mau-sac");
  process.exit(1);
}

const slug = rawName.toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
if (!slug) { console.error("Tên không hợp lệ."); process.exit(1); }

const camel = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const dir = resolve(root, "src/plugins");
const file = resolve(dir, `${slug}.ts`);
if (existsSync(file)) {
  console.error(`✗ Đã tồn tại: src/plugins/${slug}.ts`);
  process.exit(1);
}
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const template = `/* ==========================================================
   Plugin: ${slug}
   Tự sinh bởi create-plugin. File trong src/plugins/ được loader
   nạp tự động (xem src/plugins/index.ts) — không cần sửa main.tsx.
   Sửa mảng plugins bên dưới để thêm field-type / workflow-node /
   page-widget / mcp-connector / llm-adapter.
   ========================================================== */
import { pluginRegistry, type PluginModule } from "@erp-framework/core";

const ${camel}Module: PluginModule = {
  name: "${slug}",
  apiVersion: "0.1.0",
  plugins: [
    {
      kind: "field-type",
      type: "${slug}",
      label: "${rawName}",
      icon: "Wand",
      description: "Kiểu field do plugin ${slug} cung cấp",
      // coerce: ép giá trị thô về kiểu chuẩn (validate-on-write).
      coerce: (raw) => ({ value: raw }),
    },
  ],
};

pluginRegistry.register(${camel}Module);
`;

writeFileSync(file, template, "utf8");
console.log(`✓ Đã tạo plugin: src/plugins/${slug}.ts`);
console.log("  Loader tự nạp khi app khởi động. Mở file để chỉnh nội dung plugin.");
