/* ==========================================================
   SubmitFeedbackModal — form gửi feedback.
   - title, body, suggestion, area, severity
   - Auto-capture URL hiện tại
   - Debounced findSimilar khi title đủ dài (chặn duplicate sớm)
   - Submit thành công → nav tới /feedback/$id
   ========================================================== */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Button, Chip, FormField, Input, Modal, Select, Textarea,
} from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createFeedbackClient,
  type FeedbackArea, type FeedbackSeverity, type SimilarHit,
} from "@erp-framework/client";

const client = createFeedbackClient("");

const AREA_OPTS: Array<{ value: FeedbackArea; label: string }> = [
  { value: "entity", label: "Entity / dữ liệu" },
  { value: "workflow", label: "Workflow" },
  { value: "agent", label: "Agent / AI" },
  { value: "settings", label: "Cài đặt" },
  { value: "ui", label: "Giao diện" },
  { value: "performance", label: "Hiệu năng" },
  { value: "other", label: "Khác" },
];
const SEVERITY_OPTS: Array<{ value: FeedbackSeverity; label: string }> = [
  { value: "nice_to_have", label: "Mong muốn" },
  { value: "normal", label: "Bình thường" },
  { value: "blocker", label: "Chặn nghiêm trọng" },
];

interface Props { open: boolean; onClose: () => void }

export function SubmitFeedbackModal({ open, onClose }: Props) {
  const loc = useLocation();
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [area, setArea] = useState<FeedbackArea>("ui");
  const [severity, setSeverity] = useState<FeedbackSeverity>("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [similar, setSimilar] = useState<SimilarHit[]>([]);

  // TanStack: loc.search là OBJECT parsed; chuỗi gốc nằm ở loc.searchStr.
  // Dùng href = pathname + searchStr + hash đầy đủ.
  const url = useMemo(() => loc.href, [loc.href]);

  // Reset khi mở lại.
  useEffect(() => {
    if (!open) return;
    setTitle(""); setBody(""); setSuggestion("");
    setArea("ui"); setSeverity("normal");
    setErr(""); setSimilar([]);
  }, [open]);

  // Debounced findSimilar — chỉ chạy khi title đủ dài.
  useEffect(() => {
    if (!open) return;
    const t = title.trim();
    if (t.length < 8) { setSimilar([]); return; }
    const handle = setTimeout(() => {
      client.findSimilar({ title: t, body: body.slice(0, 500) })
        .then(setSimilar)
        .catch(() => setSimilar([]));
    }, 500);
    return () => clearTimeout(handle);
  }, [open, title, body]);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await client.create({
        title: title.trim(),
        body: body.trim(),
        suggestion: suggestion.trim() || undefined,
        area, severity, url,
      });
      onClose();
      await nav({ to: "/feedback/$id", params: { id: r.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={640}
      title="Gửi phản hồi / đề xuất cải thiện"
      footer={
        <>
          <Button variant="default" onClick={onClose} disabled={busy}>Huỷ</Button>
          <Button variant="primary" onClick={submit}
            disabled={busy || title.trim().length < 3 || body.trim().length < 10}
            icon={<I.Send size={14} />}>Gửi</Button>
        </>
      }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Khu vực">
            <Select value={area} onChange={(e) => setArea(e.target.value as FeedbackArea)}>
              {AREA_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Mức độ">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}>
              {SEVERITY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Tiêu đề">
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Mô tả ngắn gọn bất cập gặp phải" maxLength={200} />
        </FormField>

        {similar.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
            <div className="font-medium mb-1 flex items-center gap-1">
              <I.AlertCircle size={12} /> Có thể trùng với:
            </div>
            <ul className="space-y-0.5">
              {similar.map((s) => (
                <li key={s.id}>
                  <Link to="/feedback/$id" params={{ id: s.id }}
                    className="text-accent hover:underline"
                    onClick={onClose}>
                    {s.title}
                  </Link>{" "}
                  <Chip className="!text-[10px]">{s.status}</Chip>
                  <span className="text-muted ml-1">
                    ({Math.round(s.similarity * 100)}% tương tự)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormField label="Mô tả bất cập" hint="Bạn gặp vấn đề gì, lặp lại thế nào, ảnh hưởng ra sao.">
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="VD: Khi nhập email vào form đăng nhập, lần sau quay lại không nhớ giúp." />
        </FormField>
        <FormField label="Đề xuất cải thiện (tuỳ chọn)">
          <Textarea rows={3} value={suggestion} onChange={(e) => setSuggestion(e.target.value)}
            placeholder="VD: Thêm tuỳ chọn 'Ghi nhớ tôi' giống các app khác." />
        </FormField>

        <div className="text-[11px] text-muted">
          Trang hiện tại: <code>{url}</code> sẽ được đính kèm tự động.
        </div>
        {err && <Chip variant="danger">{err}</Chip>}
      </div>
    </Modal>
  );
}
