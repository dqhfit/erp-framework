/* ==========================================================
   /feedback/proposals — Admin preview & duyệt đề xuất AI (ai_proposals)
   + quản lý Lộ trình nâng cấp (roadmap_items).

   AI (qua MCP /mcp) chỉ TẠO đề xuất pending. Tại đây admin xem preview
   (summary + danh sách hành động) rồi DUYỆT (mới thực thi: đổi status /
   đánh dấu trùng / thêm lộ trình) hoặc TỪ CHỐI. Chỉ admin.
   ========================================================== */
import {
  createFeedbackClient,
  type ProposalAction,
  type ProposalDetail,
  type ProposalListItem,
  type ProposalStatus,
  type RoadmapItem,
} from "@erp-framework/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { Button, Card, Chip, EmptyState, Select, Tabs } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";

const client = createFeedbackClient("");

function proposalStatusVariant(s: ProposalStatus) {
  if (s === "applied") return "success" as const;
  if (s === "rejected" || s === "superseded") return "default" as const;
  if (s === "approved") return "warning" as const;
  return "warning" as const; // pending
}

/** Key ổn định theo nội dung (tránh dùng index mảng làm key). */
function actionKey(a: ProposalAction): string {
  if (a.type === "set_status") return `set:${a.status}:${a.feedbackIds.join(",")}`;
  if (a.type === "mark_duplicate") return `dup:${a.primaryId}`;
  return `road:${a.roadmapId ?? a.roadmap?.title ?? ""}`;
}

/** Mô tả 1 hành động dạng người-đọc-được. */
function describeAction(a: ProposalAction, t: (k: string) => string): string {
  if (a.type === "set_status") {
    return `${t("proposals.act_set_status")}: ${a.feedbackIds.length} mục → ${a.status}`;
  }
  if (a.type === "mark_duplicate") {
    return `${t("proposals.act_mark_dup")}: ${a.duplicateIds.length} mục trùng với 1 mục gốc → ${a.status ?? "wontfix"}`;
  }
  const r = a.roadmap ? `"${a.roadmap.title}"` : `#${a.roadmapId?.slice(0, 8)}`;
  return `${t("proposals.act_roadmap")}: ${r} (${(a.feedbackIds ?? []).length} feedback)`;
}

function ProposalPanel() {
  const t = useT();
  const [statusFilter, setStatusFilter] = useState<"" | ProposalStatus>("pending");
  const [list, setList] = useState<ProposalListItem[]>([]);
  const [sel, setSel] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    client
      .listProposals({ status: statusFilter || undefined })
      .then(setList)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  const open = (id: string) => {
    setErr("");
    client
      .getProposal(id)
      .then(setSel)
      .catch((e) => setErr((e as Error).message));
  };

  const approve = async (p: ProposalDetail) => {
    const ok = await dialog.confirm(t("proposals.approve_confirm"), {
      title: t("proposals.approve_btn"),
    });
    if (!ok) return;
    const note = await dialog.prompt(t("proposals.review_note_prompt"), "");
    setBusy(true);
    try {
      const r = await client.approveProposal({ id: p.id, reviewNote: note || undefined });
      await dialog.alert(
        t("proposals.applied_ok")
          .replace("{status}", String(r.result.statusUpdated))
          .replace("{dup}", String(r.result.duplicatesMarked))
          .replace(
            "{road}",
            String(r.result.roadmapCreated.length + r.result.roadmapLinked.length),
          ),
      );
      setSel(null);
      reload();
    } catch (e) {
      await dialog.alert((e as Error).message, { title: t("common.error") });
    } finally {
      setBusy(false);
    }
  };

  const reject = async (p: ProposalDetail) => {
    const note = await dialog.prompt(t("proposals.reject_note_prompt"), "");
    if (note === null) return;
    setBusy(true);
    try {
      await client.rejectProposal({ id: p.id, reviewNote: note || undefined });
      setSel(null);
      reload();
    } catch (e) {
      await dialog.alert((e as Error).message, { title: t("common.error") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 mt-4">
      {/* Danh sách */}
      <div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="mb-2 w-full"
        >
          <option value="">{t("proposals.status_all")}</option>
          <option value="pending">{t("proposals.status_pending")}</option>
          <option value="applied">{t("proposals.status_applied")}</option>
          <option value="rejected">{t("proposals.status_rejected")}</option>
          <option value="superseded">{t("proposals.status_superseded")}</option>
        </Select>
        {loading && <div className="text-sm text-muted">{t("feedback.loading")}</div>}
        {err && <Chip variant="danger">{err}</Chip>}
        {!loading && list.length === 0 && (
          <EmptyState
            icon={<I.Sparkles size={24} />}
            title={t("proposals.empty_title")}
            hint={t("proposals.empty_hint")}
          />
        )}
        <div className="space-y-2">
          {list.map((p) => (
            <Card
              key={p.id}
              className={`cursor-pointer hover:opacity-90 ${sel?.id === p.id ? "ring-2 ring-primary" : ""}`}
              onClick={() => open(p.id)}
            >
              <div className="flex items-center gap-2">
                <I.Bot size={14} className="text-muted shrink-0" />
                <span className="font-medium text-sm flex-1 truncate">{p.title}</span>
                <Chip variant={proposalStatusVariant(p.status)} className="text-[10px]!">
                  {p.status}
                </Chip>
              </div>
              <div className="text-xs text-muted mt-1">
                {p.feedbackIds?.length ?? 0} feedback · {new Date(p.createdAt).toLocaleDateString()}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Chi tiết preview */}
      <div>
        {!sel ? (
          <EmptyState
            icon={<I.Eye size={24} />}
            title={t("proposals.preview_title")}
            hint={t("proposals.preview_hint")}
          />
        ) : (
          <Card>
            <div className="flex items-start gap-2">
              <h2 className="text-sm font-semibold flex-1">{sel.title}</h2>
              <Chip variant={proposalStatusVariant(sel.status)}>{sel.status}</Chip>
            </div>

            {sel.summary && (
              <div className="mt-3 border-t border-border pt-3">
                <Markdown text={sel.summary} />
              </div>
            )}

            <div className="mt-4">
              <div className="text-xs font-semibold text-muted uppercase mb-1">
                {t("proposals.actions_label")} ({sel.actions.length})
              </div>
              <div className="space-y-1">
                {sel.actions.map((a) => (
                  <div
                    key={actionKey(a)}
                    className="text-sm flex items-center gap-2 bg-bg-subtle rounded px-2 py-1"
                  >
                    <I.GitBranch size={12} className="text-muted shrink-0" />
                    {describeAction(a, t)}
                  </div>
                ))}
              </div>
            </div>

            {sel.reviewNote && (
              <div className="mt-3 text-sm text-muted">
                {t("proposals.review_note_label")}: {sel.reviewNote}
              </div>
            )}

            {sel.status === "pending" && (
              <div className="flex gap-2 mt-4 border-t border-border pt-3">
                <Button
                  variant="primary"
                  icon={<I.Check size={14} />}
                  disabled={busy}
                  onClick={() => approve(sel)}
                >
                  {t("proposals.approve_btn")}
                </Button>
                <Button
                  variant="default"
                  icon={<I.X size={14} />}
                  disabled={busy}
                  onClick={() => reject(sel)}
                >
                  {t("proposals.reject_btn")}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function RoadmapPanel() {
  const t = useT();
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    client
      .listRoadmap()
      .then(setItems)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const setStatus = async (id: string, status: RoadmapItem["status"]) => {
    await client.setRoadmapStatus({ id, status });
    reload();
  };
  const remove = async (id: string) => {
    const ok = await dialog.confirm(t("roadmap.delete_confirm"));
    if (!ok) return;
    await client.deleteRoadmap(id);
    reload();
  };

  return (
    <div className="mt-4">
      {loading && <div className="text-sm text-muted">{t("feedback.loading")}</div>}
      {err && <Chip variant="danger">{err}</Chip>}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={<I.Layers size={24} />}
          title={t("roadmap.empty_title")}
          hint={t("roadmap.empty_hint")}
        />
      )}
      <div className="space-y-2">
        {items.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{r.title}</span>
                  {r.priority === "high" && (
                    <Chip variant="danger" className="text-[10px]!">
                      high
                    </Chip>
                  )}
                  {r.area && <Chip className="text-[10px]!">{r.area}</Chip>}
                  {r.targetQuarter && <Chip className="text-[10px]!">{r.targetQuarter}</Chip>}
                  {r.source === "ai_proposal" && (
                    <Chip className="text-[10px]!">
                      <I.Sparkles size={10} /> AI
                    </Chip>
                  )}
                </div>
                {r.description && <div className="text-sm text-muted mt-1">{r.description}</div>}
                <div className="text-xs text-muted mt-1">{r.feedbackIds?.length ?? 0} feedback</div>
              </div>
              <Select
                value={r.status}
                onChange={(e) => setStatus(r.id, e.target.value as RoadmapItem["status"])}
                className="w-36"
              >
                <option value="planned">{t("roadmap.status_planned")}</option>
                <option value="in_progress">{t("roadmap.status_in_progress")}</option>
                <option value="done">{t("roadmap.status_done")}</option>
                <option value="dropped">{t("roadmap.status_dropped")}</option>
              </Select>
              <Button
                variant="ghost"
                icon={<I.Trash size={14} />}
                onClick={() => remove(r.id)}
                aria-label={t("common.delete")}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProposalsPage() {
  const t = useT();
  const navigate = useNavigate();
  const isAdmin = useAuth((s) => s.user?.role) === "admin";
  const [tab, setTab] = useState<"proposals" | "roadmap">("proposals");

  if (!isAdmin) {
    return (
      <div className="max-w-[900px] mx-auto p-6">
        <EmptyState
          icon={<I.Key size={28} />}
          title={t("proposals.admin_only_title")}
          hint={t("proposals.admin_only_hint")}
        />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-3 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Button
            variant="ghost"
            icon={<I.ChevronLeft size={16} />}
            onClick={() => navigate({ to: "/feedback" })}
          >
            {t("proposals.back")}
          </Button>
          <h1 className="text-sm font-semibold flex-1">{t("proposals.title")}</h1>
        </div>
        <div className="text-sm text-muted mb-4">{t("proposals.subtitle")}</div>

        <Tabs<"proposals" | "roadmap">
          options={[
            { value: "proposals", label: t("proposals.tab_proposals") },
            { value: "roadmap", label: t("proposals.tab_roadmap") },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "proposals" ? <ProposalPanel /> : <RoadmapPanel />}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/feedback/proposals")({
  component: ProposalsPage,
});
