/* ==========================================================
   index.ts — Plugin loader của app.
   Tự nạp MỌI module plugin (.ts) trong thư mục src/plugins/.
   Thêm một plugin = thả một file .ts vào đây (xem example.ts) —
   KHÔNG cần sửa main.tsx hay bất kỳ chỗ nào khác.
   Mỗi file plugin tự gọi pluginRegistry.register(...) khi nạp.
   ========================================================== */

// import.meta.glob (Vite) — quét file lúc build, eager → nạp đồng bộ
// ngay khi module này được import, kích hoạt side-effect đăng ký.
const modules = import.meta.glob(["./*.ts", "!./index.ts"], { eager: true });

/** Danh sách file plugin đã nạp — tiện cho trang "Plugins" / debug. */
export const loadedPluginFiles: string[] = Object.keys(modules)
  .map((p) => p.replace(/^\.\//, ""))
  .sort();
