/* ==========================================================
   auth.ts — Client xác thực: bọc các thủ tục auth.* của server.
   Tách khỏi DataSource vì auth là việc của phiên/cookie, không
   thuộc hợp đồng dữ liệu. Dùng cùng credentials với ApiDataSource.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

/** Tạo client gọi auth.register / login / logout / me của server. */
export function createAuthClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    register: (email: string, name: string, password: string) =>
      trpc.auth.register.mutate({ email, name, password }),
    login: (email: string, password: string) => trpc.auth.login.mutate({ email, password }),
    logout: () => trpc.auth.logout.mutate(),
    me: () => trpc.auth.me.query(),
    /** Đăng ký có mở không (chưa có admin) — frontend ẩn màn đăng ký khi đã có. */
    registrationOpen: () => trpc.auth.registrationOpen.query(),
    /** Preview thông tin invite — public, dùng cho trang /invite. */
    invitePreview: (token: string) => trpc.auth.invitePreview.query({ token }),
    /** Accept invite: đặt mật khẩu lần đầu + auto-login. */
    acceptInvite: (token: string, password: string) =>
      trpc.auth.acceptInvite.mutate({ token, password }),
    /** Preview generic invite link (không cần email) -- public. */
    inviteLinkPreview: (token: string) => trpc.auth.inviteLinkPreview.query({ token }),
    /** Đăng ký qua invite link: tự nhập tên + email + mật khẩu. */
    acceptInviteLink: (token: string, name: string, email: string, password: string) =>
      trpc.auth.acceptInviteLink.mutate({ token, name, email, password }),
  };
}
