import { createOrgClient } from "@erp-framework/client";
/* ==========================================================
   org-chart — Sơ đồ phân cấp agent. Mỗi agent có thể chọn agent
   cấp trên (managerId); trang dựng cây từ quan hệ đó.

   Hai chế độ xem:
   - Danh sách: cây thụt lề, có Select đổi cấp trên ngay mỗi hàng.
   - Sơ đồ: gia phả / sơ đồ tổ chức trực quan, hộp nối bằng đường
     kẻ, từ trên xuống. Bấm vào hộp để đổi cấp trên inline.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Card, Chip, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

const org = createOrgClient("");

interface OrgAgent {
  id: string;
  name: string;
  model: string;
  managerId: string | null;
}

type ViewMode = "list" | "chart";

function OrgChartRoute() {
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<ViewMode>("chart");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = () => {
    org
      .listAgents()
      .then((r) => setAgents(r as OrgAgent[]))
      .catch(() => {
        /* chưa đăng nhập */
      });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    load();
  }, []);

  const setManager = async (a: OrgAgent, managerId: string | null) => {
    setBusy(true);
    setErr("");
    try {
      await org.setManager(a, managerId);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byId = new Map(agents.map((a) => [a.id, a]));
  const isRoot = (a: OrgAgent) => !a.managerId || !byId.has(a.managerId);
  const roots = agents.filter(isRoot);
  const childrenOf = (id: string) => agents.filter((x) => x.managerId === id);

  /* ── Chế độ Danh sách — cây thụt lề có Select ── */
  const renderListNode = (a: OrgAgent, depth: number, seen: Set<string>): ReactNode => {
    if (seen.has(a.id)) return null;
    seen.add(a.id);
    const kids = childrenOf(a.id);
    return (
      <div key={a.id}>
        <div
          className="flex items-center gap-2 py-1.5 border-b border-border"
          style={{ paddingLeft: depth * 24 }}
        >
          {depth > 0 && <I.ChevronRight size={12} className="text-muted shrink-0" />}
          <I.Bot size={15} className="text-accent shrink-0" />
          <span className="font-medium">{a.name}</span>
          <Chip className="text-[10px]!">{a.model}</Chip>
          <div className="flex-1" />
          <span className="text-xs text-muted">Cấp trên:</span>
          <Select
            value={a.managerId ?? ""}
            disabled={busy}
            onChange={(e) => void setManager(a, e.target.value || null)}
            className="h-7! text-xs! max-w-[200px]"
          >
            <option value="">— (cấp cao nhất)</option>
            {agents
              .filter((o) => o.id !== a.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </Select>
        </div>
        {kids.map((k) => renderListNode(k, depth + 1, seen))}
      </div>
    );
  };

  /* ── Chế độ Sơ đồ — hộp nối bằng đường kẻ, từ trên xuống ── */
  const renderChartNode = (a: OrgAgent, seen: Set<string>): ReactNode => {
    if (seen.has(a.id)) return null;
    seen.add(a.id);
    const kids = childrenOf(a.id).filter((k) => !seen.has(k.id));
    const isSelected = selectedId === a.id;
    const managerName = a.managerId
      ? (agents.find((x) => x.id === a.managerId)?.name ?? null)
      : null;
    return (
      <div key={a.id} className="flex flex-col items-center">
        {/* Hộp agent — click để chỉnh cấp trên */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedId(isSelected ? null : a.id)}
          onKeyDown={(e) => e.key === "Enter" && setSelectedId(isSelected ? null : a.id)}
          className={cn(
            "rounded-lg border bg-panel px-3 py-2 shadow-xs flex flex-col items-center gap-1 min-w-[160px] cursor-pointer transition-colors select-none",
            isSelected ? "border-accent bg-accent/10" : "border-border hover:border-accent/50",
          )}
        >
          <div className="flex items-center gap-1.5 w-full justify-center">
            <I.Bot size={15} className="text-accent shrink-0" />
            <span className="font-medium text-sm">{a.name}</span>
            <I.ChevronDown
              size={11}
              className={cn("text-muted ml-auto transition-transform", isSelected && "rotate-180")}
            />
          </div>
          <Chip className="text-[10px]!">{a.model}</Chip>
          {!isSelected && managerName && (
            <div className="text-[10px] text-muted/70">↑ {managerName}</div>
          )}
          {isSelected && (
            <div
              className="w-full mt-1 border-t border-border/60 pt-2 space-y-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div className="text-[10px] text-muted font-medium">Cấp trên:</div>
              <Select
                value={a.managerId ?? ""}
                disabled={busy}
                onChange={(e) => {
                  void setManager(a, e.target.value || null);
                  setSelectedId(null);
                }}
                className="h-7! text-xs! w-full"
              >
                <option value="">— (cấp cao nhất) —</option>
                {agents
                  .filter((o) => o.id !== a.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
        </div>

        {kids.length > 0 && (
          <>
            {/* Đường dọc từ hộp cha xuống thanh ngang */}
            <div className="w-px h-5 bg-border" />
            {/* Hàng con — mỗi con tự vẽ nửa đường ngang + đường dọc lên */}
            <div className="flex items-start">
              {kids.map((k, i) => {
                const first = i === 0;
                const last = i === kids.length - 1;
                return (
                  <div key={k.id} className="relative flex flex-col items-center px-3 pt-5">
                    {/* Thanh ngang nối các con (cắt nửa ở hai đầu) */}
                    <div
                      className="absolute top-0 h-px bg-border"
                      style={{ left: first ? "50%" : 0, right: last ? "50%" : 0 }}
                    />
                    {/* Đường dọc từ thanh ngang xuống hộp con */}
                    <div className="absolute top-0 w-px h-5 bg-border left-1/2 -translate-x-1/2" />
                    {renderChartNode(k, seen)}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  const ToggleBtn = ({ mode, icon, label }: { mode: ViewMode; icon: ReactNode; label: string }) => (
    <button
      type="button"
      onClick={() => setView(mode)}
      className={cn(
        "flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md border transition-colors",
        view === mode
          ? "border-accent bg-accent/10 text-accent"
          : "border-border text-muted hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="overflow-auto h-full">
      <div className="max-w-[1100px] mx-auto p-8">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-xl font-semibold">Sơ đồ phân cấp agent</h1>
          <div className="flex items-center gap-1.5 shrink-0">
            <ToggleBtn mode="chart" icon={<I.GitBranch size={13} />} label="Sơ đồ" />
            <ToggleBtn mode="list" icon={<I.List size={13} />} label="Danh sách" />
          </div>
        </div>
        <div className="text-sm text-muted mb-6">
          Gán agent cấp trên để dựng cây tổ chức — agent quản lý có thể điều phối agent cấp dưới.
          Bấm vào hộp agent để đổi cấp trên (ở cả hai chế độ xem).
        </div>

        {agents.length === 0 ? (
          <Card>
            <div className="text-sm text-muted">Chưa có agent nào.</div>
          </Card>
        ) : view === "list" ? (
          <Card>{roots.map((r) => renderListNode(r, 0, new Set<string>()))}</Card>
        ) : (
          <Card className="overflow-x-auto">
            <div className="flex items-start justify-center gap-10 min-w-min py-4">
              {(() => {
                const seen = new Set<string>();
                return roots.map((r) => renderChartNode(r, seen));
              })()}
            </div>
          </Card>
        )}

        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/org-chart")({ component: OrgChartRoute });
