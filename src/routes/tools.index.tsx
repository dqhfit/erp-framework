import { I } from "@/components/Icons";
import { Card, Chip, EmptyState, Input, Select } from "@/components/ui";
import { type ToolListItem, createToolsClient } from "@erp-framework/client";
/* ==========================================================
   /tools — Gallery launcher cho các tool đã đăng ký.
   Card grid, filter category + kind, search. Click → /tools/$slug.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

const tools = createToolsClient("");

function ToolsGallery() {
  const nav = useNavigate();
  const [list, setList] = useState<ToolListItem[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    tools
      .list()
      .then((r) => setList(r))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((t) => {
      if (kind && t.kind !== kind) return false;
      if (q) {
        const hay = [
          t.displayName,
          t.name,
          t.manifest.description ?? "",
          ...(t.manifest.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, search, kind]);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1200px] mx-auto p-6">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-semibold flex-1">Tools</h1>
          <Input
            className="w-64"
            placeholder="Tìm tool…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Tất cả kind</option>
            <option value="web-app">web-app</option>
            <option value="mcp-server">mcp-server</option>
            <option value="cli">cli</option>
            <option value="plugin">plugin</option>
          </Select>
        </div>

        {loading && <div className="text-sm text-muted">Đang tải…</div>}
        {err && <Chip variant="danger">{err}</Chip>}

        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<I.Wand size={28} />}
            title="Chưa có tool nào"
            hint='Vào Cài đặt → "Quản lý Tools" để quét TOOLS_DIR hoặc đăng ký một remote manifest URL.'
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="cursor-pointer hover:border-accent transition"
              onClick={() => void nav({ to: "/tools/$slug", params: { slug: t.id } })}
            >
              <div className="flex items-start gap-3">
                <I.Wand size={20} className="text-accent shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{t.displayName ?? t.name}</div>
                  {t.manifest.description && (
                    <div className="text-xs text-muted line-clamp-2 mt-0.5">
                      {t.manifest.description}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Chip className="!text-[10px]">{t.kind}</Chip>
                    <Chip className="!text-[10px]">{t.runtime}</Chip>
                    {t.enabledForCompany && (
                      <Chip variant="success" className="!text-[10px]">
                        đã bật
                      </Chip>
                    )}
                    {t.status === "running" && (
                      <Chip variant="success" className="!text-[10px]">
                        running
                      </Chip>
                    )}
                    {t.status === "error" && (
                      <Chip variant="danger" className="!text-[10px]">
                        lỗi
                      </Chip>
                    )}
                    {(t.manifest.tags ?? []).slice(0, 3).map((tag) => (
                      <Chip key={tag} className="!text-[10px]">
                        #{tag}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/tools/")({
  component: ToolsGallery,
});
