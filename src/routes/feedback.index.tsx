import {
  createFeedbackClient,
  type FeedbackArea,
  type FeedbackListItem,
  type FeedbackStatus,
} from "@erp-framework/client";
/* ==========================================================
   /feedback — List feedback của công ty, filter status/area + tab Mine.
   Sort: voteCount desc → createdAt desc. AI summary hiển thị nếu có.
   ========================================================== */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MergeFeedbackModal } from "@/components/feedback/MergeFeedbackModal";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { I } from "@/components/Icons";
import { Button, Card, Chip, EmptyState, Select, Tabs } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";

const client = createFeedbackClient("");

function statusVariant(s: FeedbackStatus) {
  if (s === "done") return "success" as const;
  if (s === "wontfix") return "default" as const;
  if (s === "in_progress") return "warning" as const;
  return "default" as const;
}

function FeedbackIndex() {
  const t = useT();
  const STATUS_OPTS: Array<{ value: "" | FeedbackStatus; label: string }> = [
    { value: "", label: t("feedback.status_all") },
    { value: "new", label: t("feedback.status_new") },
    { value: "in_progress", label: t("feedback.status_in_progress") },
    { value: "done", label: t("feedback.status_done") },
    { value: "wontfix", label: t("feedback.status_wontfix") },
  ];
  const AREA_OPTS: Array<{ value: "" | FeedbackArea; label: string }> = [
    { value: "", label: t("feedback.area_all") },
    { value: "entity", label: t("feedback.area_entity") },
    { value: "workflow", label: t("feedback.area_workflow") },
    { value: "agent", label: t("feedback.area_agent") },
    { value: "settings", label: t("feedback.area_settings") },
    { value: "ui", label: t("feedback.area_ui") },
    { value: "performance", label: t("feedback.area_performance") },
    { value: "other", label: t("feedback.area_other") },
  ];
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<"" | FeedbackStatus>("");
  const [area, setArea] = useState<"" | FeedbackArea>("");
  const [list, setList] = useState<FeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const isAdmin = useAuth((s) => s.user?.role) === "admin";
  const navigate = useNavigate();

  const filters = useMemo(
    () => ({
      status: status || undefined,
      area: area || undefined,
      mine: tab === "mine",
    }),
    [status, area, tab],
  );

  useEffect(() => {
    setLoading(true);
    client
      .list(filters)
      .then(setList)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-3 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-sm font-semibold flex-1">{t("feedback.title")}</h1>
          {isAdmin && (
            <Button
              variant="default"
              icon={<I.Sparkles size={14} />}
              onClick={() => navigate({ to: "/feedback/proposals" })}
            >
              {t("feedback.proposals_btn")}
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="default"
              icon={<I.Copy size={14} />}
              onClick={() => setMergeOpen(true)}
            >
              {t("feedback.merge_btn")}
            </Button>
          )}
          <Button variant="primary" icon={<I.Plus size={14} />} onClick={() => setSubmitOpen(true)}>
            {t("feedback.submit_btn")}
          </Button>
        </div>
        <div className="text-sm text-muted mb-4">{t("feedback.subtitle")}</div>

        <Tabs<"all" | "mine">
          options={[
            { value: "all", label: t("feedback.tab_all") },
            { value: "mine", label: t("feedback.tab_mine") },
          ]}
          value={tab}
          onChange={setTab}
        />

        <div className="flex gap-2 my-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {STATUS_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select value={area} onChange={(e) => setArea(e.target.value as typeof area)}>
            {AREA_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        {loading && <div className="text-sm text-muted">{t("feedback.loading")}</div>}
        {err && <Chip variant="danger">{err}</Chip>}
        {!loading && list.length === 0 && (
          <EmptyState
            icon={<I.HelpCircle size={28} />}
            title={t("feedback.empty_title")}
            hint={t("feedback.empty_hint")}
          />
        )}

        <div className="space-y-2">
          {list.map((f) => (
            <Card key={f.id}>
              <Link to="/feedback/$id" params={{ id: f.id }} className="block hover:opacity-90">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center justify-center w-12 shrink-0 text-center">
                    <I.ChevronUp size={14} className="text-muted" />
                    <div className="font-semibold text-sm">{f.voteCount}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{f.title}</span>
                      <Chip variant={statusVariant(f.status)} className="text-[10px]!">
                        {f.status}
                      </Chip>
                      <Chip className="text-[10px]!">{f.area}</Chip>
                      {f.severity === "blocker" && (
                        <Chip variant="danger" className="text-[10px]!">
                          blocker
                        </Chip>
                      )}
                    </div>
                    {f.aiSummary && (
                      <div className="text-xs text-muted mt-1 italic">💡 {f.aiSummary}</div>
                    )}
                    {f.aiTags && f.aiTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.aiTags.map((t) => (
                          <Chip key={t} className="text-[10px]!">
                            #{t}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      </div>
      <SubmitFeedbackModal open={submitOpen} onClose={() => setSubmitOpen(false)} />
      <MergeFeedbackModal open={mergeOpen} onClose={() => setMergeOpen(false)} filters={filters} />
    </div>
  );
}

export const Route = createFileRoute("/feedback/")({
  component: FeedbackIndex,
});
