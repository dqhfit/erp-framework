/* ==========================================================
   plugins.ts — Đăng ký plugin PHÍA SERVER vào pluginRegistry.
   workflow-runner tra registry này để THỰC THI node do plugin
   định nghĩa (nhánh default trong runWorkflow).
   Định nghĩa plugin dùng chung ở @erp-framework/plugins — app và
   server cùng một nguồn, không lặp.
   Import side-effect ở index.ts khi server khởi động.
   ========================================================== */
import { pluginRegistry } from "@erp-framework/core";
import { examplePlugins } from "@erp-framework/plugins";

pluginRegistry.register(examplePlugins);
