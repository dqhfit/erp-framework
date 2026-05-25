/* ==========================================================
   /feedback — List feedback của công ty, filter status/area + tab Mine.
   Sort: voteCount desc → createdAt desc. AI summary hiển thị nếu có.
   ========================================================== */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Button, Card, Chip, EmptyState, Select, Tabs,
} from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createFeedbackClient,
  type FeedbackArea, type FeedbackListItem, type FeedbackStatus,
} from "@erp-framework/client";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";

const client = createFeedbackClient("");

const STATUS_OPTS: Array<{ value: "" | FeedbackStatus; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "new", label: "Mới" },
  { value: "in_progress", label: "Đang xử lý" },
  { value: "done", label: "Hoàn tất" },
  { value: "wontfix", label: "Sẽ không xử lý" },
];
const AREA_OPTS: Array<{ value: "" | FeedbackArea; label: string }> = [
  { value: "", label: "Tất cả khu vực" },
  { value: "entity", label: "Entity" },
  { value: "workflow", label: "Workflow" },
  { value: "agent", label: "Agent" },
  { value: "settings", label: "Cài đặt" },
  { value: "ui", label: "Giao diện" },
  { value: "performance", label: "Hiệu năng" },
  { value: "other", label: "Khác" },
];

function statusVariant(s: FeedbackStatus) {
  if (s === "done") return "success" as const;
  if (s === "wontfix") return "default" as const;
  if (s === "in_progress") return "warning" as const;
  return "default" as const;
}

function FeedbackIndex() {
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<"" | FeedbackStatus>("");
  const [area, setArea] = useState<"" | FeedbackArea>("");
  const [list, setList] = useState<FeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);

  const filters = useMemo(() => ({
    status: status || undefined,
    area: area || undefined,
    mine: tab === "mine",
  }), [status, area, tab]);

  useEffect(() => {
    setLoading(true);
    client.list(filters)
      .then(setList)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-semibold flex-1">Phản hồi & đề xuất</h1>
          <Button variant="primary" icon={<I.Plus size={14} />}
            onClick={() => setSubmitOpen(true)}>Gửi phản hồi</Button>
        </div>
        <div className="text-sm text-muted mb-4">
          Báo cáo bất cập gặp phải khi dùng hệ thống và đề xuất hướng cải thiện.
          AI tự sinh tóm tắt + tag, phát hiện feedback tương tự, admin theo dõi pipeline.
        </div>

        <Tabs<"all" | "mine"> options={[
          { value: "all", label: "Tất cả" },
          { value: "mine", label: "Của tôi" },
        ]} value={tab} onChange={setTab} />

        <div className="flex gap-2 my-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={area} onChange={(e) => setArea(e.target.value as typeof area)}>
            {AREA_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>

        {loading && <div className="text-sm text-muted">Đang tải…</div>}
        {err && <Chip variant="danger">{err}</Chip>}
        {!loading && list.length === 0 && (
          <EmptyState icon={<I.HelpCircle size={28} />}
            title="Chưa có phản hồi nào"
            hint='Bấm "Gửi phản hồi" hoặc nút HelpCircle ở thanh trên để bắt đầu.' />
        )}

        <div className="space-y-2">
          {list.map((f) => (
            <Card key={f.id}>
              <Link to="/feedback/$id" params={{ id: f.id }}
                className="block hover:opacity-90">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center justify-center w-12 shrink-0 text-center">
                    <I.ChevronUp size={14} className="text-muted" />
                    <div className="font-semibold text-sm">{f.voteCount}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{f.title}</span>
                      <Chip variant={statusVariant(f.status)} className="!text-[10px]">
                        {f.status}
                      </Chip>
                      <Chip className="!text-[10px]">{f.area}</Chip>
                      {f.severity === "blocker" && (
                        <Chip variant="danger" className="!text-[10px]">blocker</Chip>
                      )}
                    </div>
                    {f.aiSummary && (
                      <div className="text-xs text-muted mt-1 italic">
                        💡 {f.aiSummary}
                      </div>
                    )}
                    {f.aiTags && f.aiTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.aiTags.map((t) => (
                          <Chip key={t} className="!text-[10px]">#{t}</Chip>
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
    </div>
  );
}

export const Route = createFileRoute("/feedback/")({
  component: FeedbackIndex,
});
