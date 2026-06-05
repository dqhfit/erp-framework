import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { knowledgeAccessibleSql } from "./knowledge-acl";

/* Render biểu thức SQL ra chuỗi + params để khẳng định logic ACL — không
   cần DB thật. Dùng PgDialect của drizzle (cùng engine sinh câu lệnh runtime). */
const render = (groupIds: string[]) =>
  new PgDialect().sqlToQuery(knowledgeAccessibleSql({ userId: "user-1", groupIds }));

describe("knowledgeAccessibleSql", () => {
  it("không có nhóm: company OR created_by OR resource_members, KHÔNG join nhóm", () => {
    const { sql, params } = render([]);
    expect(sql).toContain("knowledge_sources.visibility = 'company'");
    expect(sql).toContain("knowledge_sources.created_by =");
    expect(sql).toContain("resource_members");
    expect(sql).toContain("rm.resource_type = 'knowledge'");
    // Không nhóm → không thêm nhánh EXISTS trên bảng pivot nhóm.
    expect(sql).not.toContain("knowledge_source_viewer_groups");
    expect(params).toContain("user-1");
  });

  it("có nhóm: thêm nhánh EXISTS trên knowledge_source_viewer_groups + bind id nhóm", () => {
    const { sql, params } = render(["grp-a", "grp-b"]);
    expect(sql).toContain("knowledge_source_viewer_groups");
    expect(sql).toContain("kg.source_id = knowledge_sources.id");
    expect(params).toEqual(expect.arrayContaining(["user-1", "grp-a", "grp-b"]));
  });
});
