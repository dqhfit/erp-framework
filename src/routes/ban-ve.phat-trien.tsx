import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";

export const Route = createFileRoute("/ban-ve/phat-trien")({
  component: () => <BanVeTypePage phanloai="Bản vẽ phát triển" />,
});
