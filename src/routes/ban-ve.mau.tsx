import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";

export const Route = createFileRoute("/ban-ve/mau")({
  component: () => <BanVeTypePage phanloai="Bản vẽ mẫu" />,
});
