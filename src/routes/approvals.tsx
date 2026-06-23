import { createApprovalsClient } from "@erp-framework/client";
/* ==========================================================
   approvals — Hộp phê duyệt (governance). Tạo yêu cầu phê duyệt,
   duyệt/từ chối; đủ số tầng (requiredApprovals) → approved.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";

const approvals = createApprovalsClient("");

interface Decision {
  userId: string;
  decision: string;
  comment: string;
  at: string;
}
interface ApprovalReq {
  id: string;
  title: string;
  detail: string;
  kind: string;
  status: string;
  requiredApprovals: number;
  decisions: Decision[];
  createdAt: string | Date;
}

const STATUS_CHIP: Record<string, "default" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

function ApprovalsRoute() {
  const t = useT();
  const [list, setList] = useState<ApprovalReq[]>([]);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [required, setRequired] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    approvals
      .list()
      .then((r) => setList(r as ApprovalReq[]))
      .catch(() => {
        /* chưa đăng nhập */
      });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    void run(async () => {
      await approvals.create({
        title: title.trim(),
        detail: detail.trim() || undefined,
        requiredApprovals: required,
      });
      setTitle("");
      setDetail("");
      setRequired(1);
    });

  const pending = list.filter((r) => r.status === "pending");
  const done = list.filter((r) => r.status !== "pending");

  const renderReq = (r: ApprovalReq) => {
    const approved = r.decisions.filter((d) => d.decision === "approve").length;
    return (
      <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-medium flex-1">{r.title}</span>
          <Chip variant={STATUS_CHIP[r.status] ?? "default"}>{r.status}</Chip>
        </div>
        {r.detail && <div className="text-sm text-muted whitespace-pre-wrap">{r.detail}</div>}
        <div className="text-xs text-muted">
          {t("approvals.approved_count", {
            approved: String(approved),
            required: String(r.requiredApprovals),
            decisions: String(r.decisions.length),
          })}
        </div>
        {r.status === "pending" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<I.Check size={12} />}
              disabled={busy}
              onClick={() => void run(() => approvals.decide(r.id, "approve").then(() => {}))}
            >
              {t("approvals.approve_btn")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<I.Minus size={12} />}
              disabled={busy}
              onClick={() => void run(() => approvals.decide(r.id, "reject").then(() => {}))}
            >
              {t("approvals.reject_btn")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">{t("approvals.title")}</h1>
        <div className="text-sm text-muted mb-3">{t("approvals.subtitle")}</div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">{t("approvals.create_title")}</div>
          <Input
            placeholder={t("approvals.title_input")}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input w-full text-sm"
            rows={2}
            placeholder={t("approvals.detail_input")}
            value={detail}
            disabled={busy}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">{t("approvals.required_label")}</span>
            <Input
              type="number"
              min={1}
              max={20}
              value={required}
              disabled={busy}
              onChange={(e) => setRequired(Math.max(1, Number(e.target.value) || 1))}
              className="w-20"
            />
            <div className="flex-1" />
            <Button
              variant="primary"
              icon={<I.Plus size={14} />}
              disabled={busy || !title.trim()}
              onClick={create}
            >
              {t("approvals.create_btn")}
            </Button>
          </div>
        </Card>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">
            {t("approvals.pending_title", { count: String(pending.length) })}
          </div>
          {pending.length === 0 && (
            <div className="text-sm text-muted">{t("approvals.pending_empty")}</div>
          )}
          {pending.map(renderReq)}
        </Card>

        {done.length > 0 && (
          <Card className="space-y-2">
            <div className="font-semibold">
              {t("approvals.done_title", { count: String(done.length) })}
            </div>
            {done.map(renderReq)}
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

export const Route = createFileRoute("/approvals")({ component: ApprovalsRoute });
