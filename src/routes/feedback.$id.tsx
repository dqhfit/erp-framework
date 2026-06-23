import {
  createFeedbackClient,
  type FeedbackCommentRow,
  type FeedbackDetail,
  type FeedbackStatus,
} from "@erp-framework/client";
/* ==========================================================
   /feedback/$id — Chi tiết 1 feedback: vote, AI summary/tags,
   comments thread, admin đổi status.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { Button, Card, Chip, FormField, Input, Select, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";

const client = createFeedbackClient("");

function statusVariant(s: FeedbackStatus) {
  if (s === "done") return "success" as const;
  if (s === "in_progress") return "warning" as const;
  return "default" as const;
}

function FeedbackDetailRoute() {
  const t = useT();
  const STATUS_OPTS: Array<{ value: FeedbackStatus; label: string }> = [
    { value: "new", label: t("feedback.status_new") },
    { value: "in_progress", label: t("feedback.status_in_progress") },
    { value: "done", label: t("feedback.status_done") },
    { value: "wontfix", label: t("feedback.status_wontfix") },
  ];
  const { id } = Route.useParams();
  const nav = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const isAdmin = role === "admin";

  const [fb, setFb] = useState<FeedbackDetail | null>(null);
  const [comments, setComments] = useState<FeedbackCommentRow[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newStatus, setNewStatus] = useState<FeedbackStatus>("new");
  const [resolution, setResolution] = useState("");

  const load = () => {
    client
      .get(id)
      .then((d) => {
        setFb(d);
        setNewStatus(d.status);
        setResolution(d.resolutionNote ?? "");
      })
      .catch((e) => setErr((e as Error).message));
    client
      .listComments(id)
      .then(setComments)
      .catch(() => {});
  };
  useEffect(load, [id]);

  const vote = () =>
    void (async () => {
      if (!fb) return;
      setBusy(true);
      try {
        if (fb.myVote) await client.unvote(id);
        else await client.vote(id);
        load();
      } finally {
        setBusy(false);
      }
    })();

  const submitComment = async () => {
    if (!commentBody.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await client.addComment({ feedbackId: id, body: commentBody });
      setCommentBody("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyStatus = async () => {
    if (!fb || newStatus === fb.status) return;
    setBusy(true);
    setErr("");
    try {
      await client.setStatus({
        id,
        status: newStatus,
        resolutionNote: resolution.trim() || undefined,
      });
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!fb && !err) return <div className="p-6 text-sm text-muted">{t("feedback.loading")}</div>;
  if (err && !fb)
    return (
      <div className="p-6">
        <Chip variant="danger">{err}</Chip>
      </div>
    );
  if (!fb) return null;

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-3 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Button
            size="sm"
            variant="default"
            icon={<I.ChevronLeft size={14} />}
            onClick={() => void nav({ to: "/feedback" })}
          >
            {t("feedback.back_btn")}
          </Button>
          <Chip variant={statusVariant(fb.status)}>{fb.status}</Chip>
          <Chip>{fb.area}</Chip>
          {fb.severity === "blocker" && <Chip variant="danger">blocker</Chip>}
          <div className="flex-1" />
          <Button
            size="sm"
            variant={fb.myVote ? "primary" : "default"}
            icon={<I.ChevronUp size={14} />}
            disabled={busy}
            onClick={vote}
          >
            {fb.myVote ? t("feedback.voted") : "Vote"} ({fb.voteCount})
          </Button>
        </div>

        <h1 className="text-base font-semibold mb-1">{fb.title}</h1>
        {fb.url && (
          <div className="text-xs text-muted mb-3">
            {t("feedback.source_page")} <code>{fb.url}</code>
          </div>
        )}

        {fb.aiSummary && (
          <Card className="mb-3 bg-accent/5 border-accent/20">
            <div className="text-xs uppercase text-accent font-semibold mb-1">
              ✨ {t("feedback.ai_summary_label")}
            </div>
            <Markdown text={fb.aiSummary} />
            {fb.aiTags && fb.aiTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {fb.aiTags.map((t) => (
                  <Chip key={t} className="text-[10px]!">
                    #{t}
                  </Chip>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="mb-3">
          <div className="text-xs uppercase text-muted font-semibold mb-1">
            {t("feedback.issue_label")}
          </div>
          <div className="whitespace-pre-wrap text-sm">{fb.body}</div>
        </Card>

        {fb.suggestion && (
          <Card className="mb-3">
            <div className="text-xs uppercase text-muted font-semibold mb-1">
              {t("feedback.suggestion_label")}
            </div>
            <div className="whitespace-pre-wrap text-sm">{fb.suggestion}</div>
          </Card>
        )}

        {fb.resolutionNote && (
          <Card className="mb-3">
            <div className="text-xs uppercase text-muted font-semibold mb-1">
              {t("feedback.resolution_label")}
            </div>
            <div className="whitespace-pre-wrap text-sm">{fb.resolutionNote}</div>
          </Card>
        )}

        {isAdmin && (
          <Card className="mb-3 border-warning/40">
            <div className="font-semibold mb-2">{t("feedback.admin_status_title")}</div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as FeedbackStatus)}
              >
                {STATUS_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Input
                className="col-span-2"
                placeholder={t("feedback.resolution_placeholder")}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </div>
            <Button
              className="mt-2"
              variant="primary"
              size="sm"
              disabled={busy || newStatus === fb.status}
              onClick={applyStatus}
            >
              {t("feedback.update_btn")}
            </Button>
          </Card>
        )}

        <Card className="mb-3">
          <div className="font-semibold mb-2">
            {t("feedback.comments_title", { count: String(comments.length) })}
          </div>
          <div className="space-y-2 mb-3">
            {comments.length === 0 && (
              <div className="text-sm text-muted">{t("feedback.comments_empty")}</div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="border-l-2 border-border pl-3 py-1">
                <div className="text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</div>
                <div className="text-sm whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
          <FormField label={t("feedback.add_comment_label")} hint={t("feedback.add_comment_hint")}>
            <Textarea
              rows={3}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
            />
          </FormField>
          <Button
            className="mt-2"
            variant="primary"
            size="sm"
            disabled={busy || !commentBody.trim()}
            onClick={submitComment}
            icon={<I.Send size={14} />}
          >
            {t("feedback.send_btn")}
          </Button>
        </Card>

        {err && <Chip variant="danger">{err}</Chip>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/feedback/$id")({
  component: FeedbackDetailRoute,
});
