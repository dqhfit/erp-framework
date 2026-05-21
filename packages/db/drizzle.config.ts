import { defineConfig } from "drizzle-kit";

/* Cấu hình drizzle-kit. schemaFilter giới hạn ở "public" để cô lập
   schema "pgboss" mà pg-boss tự tạo — xem UPGRADE-PLAN mục 3.2.1. */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/erp_framework",
  },
});
