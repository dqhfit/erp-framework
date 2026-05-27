import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Vitest — unit test cho src/. Thư mục e2e/ là Playwright spec,
  // loại khỏi vitest để không bị gom nhầm.
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Chỉ đo coverage cho code thực sự (src/ + packages/*/src/),
      // loại test file, types, route tree generated, config.
      include: ["packages/*/src/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.d.ts",
        "**/routeTree.gen.ts",
        "**/types/**",
        "**/migrations/**",
      ],
      // Ratchet baseline 2026-05-26 sau Phase H (8 router tests):
      //   2.92% → 6.60% statements; 1.49% → 4.54% functions; lines 7.07%;
      //   branches 1.88% → 4.71%. 151 test (+95 từ baseline 56).
      // Routers covered: enums/feedback/pages/schedules/entities/workflows/
      // agents/tools. Sprint sau test thêm records (lớn nhất) + companies
      // + entity-sync để leo 15-25%.
      thresholds: { lines: 7.0, statements: 6.5, functions: 4.4, branches: 4.5 },
    },
  },
  server: {
    // Bind IPv4 — tránh EACCES khi Windows chặn IPv6 (::1) trên cổng này.
    host: "127.0.0.1",
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
      // Agent chat SSE — không buffer để stream chảy ngay.
      "/agent": {
        target: process.env.API_TARGET ?? "http://127.0.0.1:8910",
        changeOrigin: true,
      },
      // Tải file lên Knowledge Base (multipart/form-data).
      "/upload": {
        target: process.env.API_TARGET ?? "http://127.0.0.1:8910",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        /* Tách bundle để main chunk <500KB:
           - react-vendor: react core (chia sẻ mọi nơi)
           - router: TanStack Router + lib config
           - query: TanStack React Query + Table
           - designer: xyflow + dnd-kit (chỉ EntityDesigner/PageDesigner/
             WorkflowDesigner dùng — sẽ lazy load route)
           - viz: recharts + leaflet (Dashboard + Map views)
           - icons: lucide-react (đôi khi gom được)
           Các package khác giữ trong main chunk.
           Mỗi alias chỉ match khi import path khớp prefix → tránh
           false-positive (vd "@tanstack/react-virtual" không vào router). */
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-dom/client"],
          router: ["@tanstack/react-router"],
          query: ["@tanstack/react-query", "@tanstack/react-table"],
          designer: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable"],
          viz: ["recharts", "leaflet", "react-leaflet"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
