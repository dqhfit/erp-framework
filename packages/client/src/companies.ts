/* ==========================================================
   companies.ts — Client đa công ty: bọc các thủ tục companies.*
   của server. Dùng cho company switcher + trang quản lý công ty.
   Cùng cơ chế cookie phiên như ApiDataSource / AuthClient.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type CompanyRole = "admin" | "editor" | "viewer";

/** Tạo client gọi companies.* của server. */
export function createCompaniesClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Danh sách công ty user là thành viên (dùng cho switcher). */
    list: () => trpc.companies.list.query(),
    /** Công ty đang chọn của phiên. */
    current: () => trpc.companies.current.query(),
    /** Chuyển công ty đang làm việc. */
    switch: (companyId: string) =>
      trpc.companies.switch.mutate({ companyId }),
    /** Tạo công ty mới (admin). */
    create: (name: string, slug?: string) =>
      trpc.companies.create.mutate({ name, ...(slug ? { slug } : {}) }),
    /** Đổi tên công ty đang chọn (admin). */
    rename: (name: string) => trpc.companies.rename.mutate({ name }),
    /** Thành viên của công ty đang chọn. */
    members: () => trpc.companies.members.query(),
    /** Thêm thành viên — email mới cần password để tạo tài khoản. */
    addMember: (input: {
      email: string;
      name?: string;
      password?: string;
      role?: CompanyRole;
    }) => trpc.companies.addMember.mutate(input),
    /** Đổi vai trò một thành viên. */
    setMemberRole: (userId: string, role: CompanyRole) =>
      trpc.companies.setMemberRole.mutate({ userId, role }),
    /** Gỡ một thành viên khỏi công ty. */
    removeMember: (userId: string) =>
      trpc.companies.removeMember.mutate({ userId }),
  };
}

export type CompaniesClient = ReturnType<typeof createCompaniesClient>;
