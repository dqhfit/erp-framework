import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useNavTree } from "@/hooks/useNavTree";
import { useUserObjects } from "@/stores/userObjects";

function BanVeKyThuatRoute() {
  const { data: navNodes } = useNavTree();
  const pages = useUserObjects((s) => s.pages);
  const pageContent = useUserObjects((s) => s.pageContent);

  // 1. Tìm pageId liên kết trong menu với mã bbiBanVe hoặc I1
  const menuNode = navNodes?.find((n) => n.code === "bbiBanVe" || n.code === "I1");
  let activePageId = menuNode?.pageId;

  // 2. Nếu chưa liên kết trong menu, tìm trang có techName bắt đầu bằng ban_ve_ky_thuat_ hoặc name khớp
  if (!activePageId) {
    const fallbackPage = pages.find(
      (p) => p.techName?.startsWith("ban_ve_ky_thuat_") || p.name === "Bản vẽ kỹ thuật",
    );
    if (fallbackPage) {
      activePageId = fallbackPage.id;
    }
  }

  // Kiểm tra trang có components thiết kế thực tế không (nếu là trang rỗng thì hiển thị fallback bản vẽ mặc định)
  const content = activePageId
    ? (pageContent[activePageId] as Record<string, unknown> | undefined)
    : null;
  const hasComponents = Array.isArray(content?.components) && content.components.length > 0;

  if (activePageId && hasComponents) {
    return (
      <div className="h-screen overflow-hidden flex flex-col bg-bg text-text">
        <ConsumerPage pageId={activePageId} />
      </div>
    );
  }

  return <BanVeTypePage phanloai="Bản vẽ kỹ thuật" />;
}

export const Route = createFileRoute("/ban-ve/ky-thuat")({
  component: BanVeKyThuatRoute,
});
