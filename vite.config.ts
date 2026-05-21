import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    strictPort: true,
    // Proxy API sang server backend → trình duyệt chỉ gọi cùng origin.
    // Target dùng 127.0.0.1 (IPv4) khớp đúng địa chỉ server bind —
    // tránh việc "localhost" phân giải sang ::1 (IPv6) làm proxy lỗi.
    proxy: {
      "/trpc": {
        target: process.env.API_TARGET ?? "http://127.0.0.1:8910",
        changeOrigin: true,
      },
    },
  },
  build: { sourcemap: true, target: "es2022" },
});
