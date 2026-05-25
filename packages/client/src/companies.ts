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
    /** Thêm thành viên — password optional: không có thì server sinh
       invite link để user tự đặt mật khẩu sau (recommended). Return
       gồm `inviteLink` khi user mới (pending). */
    addMember: (input: {
      email: string;
      name?: string;
      password?: string;
      role?: CompanyRole;
    }) => trpc.companies.addMember.mutate(input),
    /** Gửi lại invite link cho user chưa accept (pending). */
    resendInvite: (userId: string) =>
      trpc.companies.resendInvite.mutate({ userId }),
    /** Đổi vai trò một thành viên. */
    setMemberRole: (userId: string, role: CompanyRole) =>
      trpc.companies.setMemberRole.mutate({ userId, role }),
    /** Gỡ một thành viên khỏi công ty. */
    removeMember: (userId: string) =>
      trpc.companies.removeMember.mutate({ userId }),
    /** Admin đặt lại mật khẩu cho một thành viên. Xoá toàn bộ session của user đó. */
    resetMemberPassword: (userId: string, newPassword: string) =>
      trpc.companies.resetMemberPassword.mutate({ userId, newPassword }),
    /** Phê duyệt thành viên đang chờ (đăng ký qua invite link). */
    approveMember: (userId: string) =>
      trpc.companies.approveMember.mutate({ userId }),
    /** Vô hiệu hoá tài khoản thành viên trong công ty (force logout ngay). */
    disableMember: (userId: string) =>
      trpc.companies.disableMember.mutate({ userId }),
    /** Khôi phục tài khoản thành viên đã bị vô hiệu hoá. */
    enableMember: (userId: string) =>
      trpc.companies.enableMember.mutate({ userId }),
    /** Từ chối + xoá thành viên đang chờ phê duyệt. */
    rejectMember: (userId: string) =>
      trpc.companies.rejectMember.mutate({ userId }),
    /** Tạo generic invite link (không cần email). Bất kỳ ai có link tự đăng ký vào công ty. */
    createInviteLink: (role?: CompanyRole) =>
      trpc.companies.createInviteLink.mutate({ role }),
    /** Danh sách invite links của công ty (bao gồm đã dùng + đã hết hạn). */
    listInviteLinks: () => trpc.companies.listInviteLinks.query(),
    /** Thu hồi một invite link. */
    deleteInviteLink: (id: string) =>
      trpc.companies.deleteInviteLink.mutate({ id }),
  };
}

export type CompaniesClient = ReturnType<typeof createCompaniesClient>;
