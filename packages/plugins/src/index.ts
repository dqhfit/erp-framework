/* ==========================================================
   @erp-framework/plugins — plugin DÙNG CHUNG cho app + server.
   Một định nghĩa, hai nơi đăng ký:
   - app  : để plugin hiện trong designer (palette field/node).
   - server: để workflow-runner THỰC THI node do plugin định nghĩa.
   Hết lặp định nghĩa giữa app và server.

   CHU Y: plugin nao dung Node-only API (vd MssqlClient → driver
   `mssql` voi `Buffer`/`net`) PHAI export qua subpath rieng, vi du
   `./mssql-bridge`, de Vite KHONG bundle vao client bundle. Khong
   re-export tu file `index.ts` nay.
   ========================================================== */
import type { PluginModule } from "@erp-framework/core";

/** Plugin mẫu — minh hoạ Plugin SDK: một field-type + một workflow-node. */
export const examplePlugins: PluginModule = {
  name: "@erp-framework/example-plugin",
  apiVersion: "0.1.0",
  plugins: [
    {
      kind: "field-type",
      type: "rating",
      label: "Đánh giá sao",
      icon: "Sparkles",
      description: "Điểm 0–5 sao",
      // coerce: ép giá trị thô về kiểu chuẩn (validate-on-write).
      coerce: (raw) => {
        const n = Number(raw);
        if (Number.isNaN(n)) return { error: "Giá trị không phải số" };
        return { value: Math.max(0, Math.min(5, Math.round(n))) };
      },
    },
    {
      kind: "workflow-node",
      type: "log",
      label: "Ghi log",
      icon: "Activity",
      description: "Ghi một dòng log khi workflow chạy qua node này",
      run: async (ctx) => {
        const line = `[workflow] log: ${JSON.stringify(ctx.config.message ?? "")}`;
        console.log(line);
        return { detail: line, output: {} };
      },
    },
  ],
};
