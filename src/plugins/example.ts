/* ==========================================================
   example.ts — Đăng ký plugin mẫu vào app.
   Định nghĩa plugin dùng chung ở @erp-framework/plugins (app +
   server cùng dùng). File này chỉ làm nhiệm vụ ĐĂNG KÝ phía app
   để plugin hiện trong designer; loader (src/plugins/index.ts)
   tự nạp file này.
   ========================================================== */
import { pluginRegistry } from "@erp-framework/core";
import { examplePlugins } from "@erp-framework/plugins";

pluginRegistry.register(examplePlugins);
