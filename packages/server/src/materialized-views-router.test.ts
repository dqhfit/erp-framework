/* ==========================================================
   materialized-views-router.test.ts — Regression test cho
   cross-tenant SQL guard (P4.3).
   ========================================================== */

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { assertCompanyScopedSQL } from "./materialized-views-router";

describe("assertCompanyScopedSQL (P4.3)", () => {
  it("pass khi SQL có WHERE company_id = :company_id", () => {
    expect(() =>
      assertCompanyScopedSQL("SELECT * FROM entity_records WHERE company_id = :company_id"),
    ).not.toThrow();
  });

  it("pass khi SQL JOIN có company_id (defensive minimum)", () => {
    expect(() =>
      assertCompanyScopedSQL(
        "SELECT r.* FROM entity_records r JOIN entities e ON e.id = r.entity_id AND e.company_id = :company_id",
      ),
    ).not.toThrow();
  });

  it("REJECT khi SQL không reference company_id", () => {
    expect(() => assertCompanyScopedSQL("SELECT * FROM entity_records")).toThrow(TRPCError);
  });

  it("REJECT khi admin trick bằng comment chứa company_id", () => {
    expect(() => assertCompanyScopedSQL("-- company_id\nSELECT * FROM entity_records")).toThrow(
      TRPCError,
    );
    expect(() => assertCompanyScopedSQL("/* company_id */ SELECT * FROM entity_records")).toThrow(
      TRPCError,
    );
  });

  it("Case-insensitive", () => {
    expect(() =>
      assertCompanyScopedSQL("SELECT * FROM entity_records WHERE COMPANY_ID = :company_id"),
    ).not.toThrow();
  });

  it("Reject query empty", () => {
    expect(() => assertCompanyScopedSQL("")).toThrow(TRPCError);
  });

  it("Cho phép cross-table query miễn có company_id", () => {
    expect(() =>
      assertCompanyScopedSQL(
        "WITH t AS (SELECT * FROM tbl1 WHERE company_id = :company_id) SELECT * FROM t",
      ),
    ).not.toThrow();
  });
});
