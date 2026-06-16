/* ==========================================================
   WorkflowGallery — Thư viện template workflow (full page).
   Duyệt template dựng sẵn theo category, "Kích hoạt" để clone thành
   workflow mới của công ty rồi mở designer. Mirror AgentLibrary nhưng
   gọn hơn + dùng token màu semantic (CLAUDE.md mục 7).
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Drawer } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");

interface TplNode {
  id: string;
  data: { kind: string; label: string };
}
interface WorkflowTemplate {
  id: string;
  category: string;
  categoryKey: string;
  icon: string;
  name: string;
  description: string;
  tags: string[];
  triggerType: string;
  graph: { nodes: TplNode[]; edges: unknown[] };
}

export function WorkflowGalleryPage() {
  const navigate = useNavigate();
  const hydrate = useUserObjects((s) => s.hydrate);
  const [templates, setTemplates] = useState<WorkflowTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<WorkflowTemplate | null>(null);
  // Workflow công ty đã clone từ template (theo sourceTemplateId) → hiện badge + nút Cập nhật.
  const [installed, setInstalled] = useState<
    { id: string; name: string; sourceTemplateId?: string | null }[]
  >([]);

  const loadInstalled = () => {
    api.workflows
      .list()
      .then((rows) =>
        setInstalled(rows as { id: string; name: string; sourceTemplateId?: string | null }[]),
      )
      .catch(() => setInstalled([]));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần khi mở trang
  useEffect(() => {
    setLoading(true);
    api.workflows
      .listTemplates()
      .then((list) => setTemplates(list as WorkflowTemplate[]))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
    loadInstalled();
  }, []);

  // templateId → danh sách workflow đã clone từ nó.
  const installedMap = new Map<string, { id: string; name: string }[]>();
  for (const w of installed) {
    if (w.sourceTemplateId) {
      const list = installedMap.get(w.sourceTemplateId) ?? [];
      list.push({ id: w.id, name: w.name });
      installedMap.set(w.sourceTemplateId, list);
    }
  }

  // Danh sách category (theo categoryKey + nhãn category) từ template.
  const categories = Array.from(
    new Map((templates ?? []).map((t) => [t.categoryKey, t.category])).entries(),
  );

  const filtered = (templates ?? []).filter((tpl) => {
    const matchCat = activeTab === "all" || tpl.categoryKey === activeTab;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      tpl.name.toLowerCase().includes(q) ||
      tpl.description.toLowerCase().includes(q) ||
      tpl.tags.some((tag) => tag.includes(q));
    return matchCat && matchSearch;
  });

  const handleActivate = async (tpl: WorkflowTemplate) => {
    setBusy(tpl.id);
    try {
      const row = await api.workflows.instantiateTemplate(tpl.id);
      const id = (row as { id: string }).id;
      // Đồng bộ store để workflow mới hiện ở sidebar, rồi mở designer.
      await hydrate();
      navigate({ to: "/workflows/$id", params: { id } });
    } catch {
      /* no-op */
    } finally {
      setBusy(null);
    }
  };

  // Cập nhật workflow đã clone theo template mới — ghi đè graph NHÁP (cần publish lại).
  const handleUpdate = async (tpl: WorkflowTemplate, wfId: string) => {
    const ok = await dialog.confirm(
      "Ghi đè graph nháp của workflow này theo template? Tuỳ chỉnh chưa publish sẽ mất.",
      { title: "Cập nhật theo template", confirmText: "Cập nhật" },
    );
    if (!ok) return;
    setBusy(`${tpl.id}:${wfId}`);
    try {
      await api.workflows.applyTemplate(wfId, tpl.id);
      await hydrate();
      loadInstalled();
    } catch (e) {
      void dialog.alert((e as Error).message, { title: "Cập nhật lỗi" });
    } finally {
      setBusy(null);
    }
  };

  const iconFor = (name: string) => {
    const Tag = I[name as keyof typeof I] ?? I.Workflow;
    return <Tag size={18} />;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
          <I.Library size={16} />
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight">Thư viện workflow mẫu</h1>
          <p className="text-xs text-muted">{(templates ?? []).length} template</p>
        </div>
        <div className="flex-1" />
        <div className="relative w-64">
          <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Tìm theo tên, mô tả, thẻ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="shrink-0 px-6 py-2 border-b border-border flex gap-1 flex-wrap">
        <TabBtn active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          Tất cả ({(templates ?? []).length})
        </TabBtn>
        {categories.map(([key, label]) => {
          const count = (templates ?? []).filter((t) => t.categoryKey === key).length;
          return (
            <TabBtn key={key} active={activeTab === key} onClick={() => setActiveTab(key)}>
              {label} ({count})
            </TabBtn>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center h-48 text-muted text-sm">
            <I.Loader size={18} className="animate-spin mr-2" />
            Đang tải…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-muted text-sm gap-2">
            <I.SearchX size={28} />
            Không có template phù hợp.
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-panel hover:border-accent/30 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                    {iconFor(tpl.icon)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm leading-tight">{tpl.name}</div>
                    <Chip className="mt-0.5 opacity-70 text-[10px] py-0">{tpl.category}</Chip>
                  </div>
                  <button
                    type="button"
                    title="Xem trước"
                    onClick={() => setPreview(tpl)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded text-muted hover:text-text hover:bg-hover shrink-0"
                  >
                    <I.Eye size={13} />
                  </button>
                </div>

                <p className="text-xs text-muted leading-relaxed flex-1">{tpl.description}</p>

                {/* Workflow đã clone từ template này */}
                {(installedMap.get(tpl.id) ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(installedMap.get(tpl.id) ?? []).map((w) => (
                      <span
                        key={w.id}
                        className="text-[10px] text-success bg-success/10 rounded px-1.5 py-0.5 flex items-center gap-1"
                      >
                        <I.CheckCircle size={10} />
                        {w.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-muted bg-panel-2 rounded px-1.5 py-0.5">
                    {tpl.graph.nodes.length} node
                  </span>
                  <span className="text-[10px] text-muted bg-panel-2 rounded px-1.5 py-0.5">
                    {tpl.triggerType}
                  </span>
                  <div className="flex-1" />
                  {(installedMap.get(tpl.id) ?? []).map((w) => (
                    <Button
                      key={w.id}
                      size="sm"
                      variant="ghost"
                      title={`Cập nhật "${w.name}" theo template`}
                      disabled={busy === `${tpl.id}:${w.id}`}
                      onClick={() => handleUpdate(tpl, w.id)}
                      icon={
                        busy === `${tpl.id}:${w.id}` ? (
                          <I.Loader size={12} className="animate-spin" />
                        ) : (
                          <I.RefreshCw size={12} />
                        )
                      }
                    >
                      Cập nhật
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy === tpl.id}
                    onClick={() => handleActivate(tpl)}
                    icon={
                      busy === tpl.id ? (
                        <I.Loader size={12} className="animate-spin" />
                      ) : (
                        <I.Zap size={12} />
                      )
                    }
                  >
                    {busy === tpl.id ? "Đang tạo…" : "Kích hoạt"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview drawer — danh sách node của template */}
      <Drawer
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? `Xem trước: ${preview.name}` : ""}
        width={420}
      >
        {preview && (
          <div className="flex flex-col gap-4 p-4 text-sm overflow-y-auto h-full pb-8">
            <p className="text-xs text-muted leading-relaxed">{preview.description}</p>
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Các bước ({preview.graph.nodes.length})
              </div>
              <div className="flex flex-col gap-1">
                {preview.graph.nodes.map((nd) => (
                  <div
                    key={nd.id}
                    className="flex items-center gap-2 border border-border rounded-md px-2 py-1.5"
                  >
                    <Chip className="text-[10px] py-0">{nd.data.kind}</Chip>
                    <span className="text-xs">{nd.data.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {preview.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {preview.tags.map((tag) => (
                  <Chip key={tag} className="text-[10px] py-0">
                    {tag}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? "bg-accent text-white" : "bg-panel-2 text-muted hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}
