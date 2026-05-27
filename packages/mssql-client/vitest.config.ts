import { defineConfig } from "vitest/config";

// Cau hinh cuc bo cho package mssql-client. Root vite.config.ts cua repo
// load TanStack router-plugin scan src/routes/ — khong ton tai trong package
// nay nen phai override de tranh ENOENT.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
