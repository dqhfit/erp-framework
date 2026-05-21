/* ==========================================================
   example.ts — Plugin mẫu minh hoạ Plugin SDK của framework.
   Đăng ký một kiểu field tuỳ biến "rating" (đánh giá 0–5 sao).
   Import side-effect ở main.tsx → kiểu này tự hiện trong palette
   EntityDesigner mà KHÔNG sửa lõi. Đây là mẫu để bên thứ ba
   viết plugin tương tự.
   ========================================================== */
import { pluginRegistry, type PluginModule } from "@erp-framework/core";

const exampleModule: PluginModule = {
  name: "@erp-framework/example-plugin",
  apiVersion: "0.1.0",
  plugins: [
    {
      kind: "field-type",
      type: "rating",
      label: "Đánh giá sao",
      icon: "Sparkles",
      description: "Điểm 0–5 sao",
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
      run: async (ctx) => ({
        detail: `log: ${JSON.stringify(ctx.config.message ?? "")}`,
        output: {},
      }),
    },
  ],
};

pluginRegistry.register(exampleModule);
