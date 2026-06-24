// Redirect /banve → /ban-ve (đổi tên URL; giữ file để tránh 404 bookmark cũ)
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/banve")({
  beforeLoad: () => {
    throw redirect({ to: "/ban-ve" });
  },
  component: () => null,
});
