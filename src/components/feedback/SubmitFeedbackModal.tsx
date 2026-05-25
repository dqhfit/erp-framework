import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input, Modal, Select, Textarea } from "@/components/ui";
import {
  type FeedbackArea,
  type FeedbackSeverity,
  type SimilarHit,
  createFeedbackClient,
} from "@erp-framework/client";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
/* ==========================================================
   SubmitFeedbackModal — form gửi feedback.
   - title, body, suggestion, area, severity
   - Auto-capture URL hiện tại
   - Debounced findSimilar khi title đủ dài (chặn duplicate sớm)
   - Submit thành công → nav tới /feedback/$id
   ========================================================== */
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/useT";

const client = createFeedbackClient("");

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SubmitFeedbackModal({ open, onClose }: Props) {
  const t = useT();
  const AREA_OPTS: Array<{ value: FeedbackArea; label: string }> = [
    { value: "entity", label: t("feedback.area_entity") },
    { value: "workflow", label: t("feedback.area_workflow") },
    { value: "agent", label: t("feedback.area_agent") },
    { value: "settings", label: t("feedback.area_settings") },
    { value: "ui", label: t("feedback.area_ui") },
    { value: "performance", label: t("feedback.area_performance") },
    { value: "other", label: t("feedback.area_other") },
  ];
  const SEVERITY_OPTS: Array<{ value: FeedbackSeverity; label: string }> = [
    { value: "nice_to_have", label: t("feedback.sev_nice_to_have") },
    { value: "normal", label: t("feedback.sev_normal") },
    { value: "blocker", label: t("feedback.sev_blocker") },
  ];
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
    setTitle("");
    setBody("");
    setSuggestion("");
    setArea("ui");
    setSeverity("normal");
    setErr("");
    setSimilar([]);
  }, [open]);

  // Debounced findSimilar — chỉ chạy khi title đủ dài.
  useEffect(() => {
    if (!open) return;
    const t = title.trim();
    if (t.length < 8) {
      setSimilar([]);
      return;
    }
    const handle = setTimeout(() => {
      client
        .findSimilar({ title: t, body: body.slice(0, 500) })
        .then(setSimilar)
        .catch(() => setSimilar([]));
    }, 500);
    return () => clearTimeout(handle);
  }, [open, title, body]);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await client.create({
        title: title.trim(),
        body: body.trim(),
        suggestion: suggestion.trim() || undefined,
        area,
        severity,
        url,
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
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={t("feedback.modal_title")}
      footer={
        <>
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t("feedback.cancel_btn")}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || title.trim().length < 3 || body.trim().length < 10}
            icon={<I.Send size={14} />}
          >
            {t("feedback.send_btn")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <FormField label={t("feedback.area_label")}>
            <Select value={area} onChange={(e) => setArea(e.target.value as FeedbackArea)}>
              {AREA_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("feedback.severity_label")}>
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}
            >
              {SEVERITY_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label={t("feedback.title_label")}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("feedback.title_placeholder")}
            maxLength={200}
          />
        </FormField>

        {similar.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
            <div className="font-medium mb-1 flex items-center gap-1">
              <I.AlertCircle size={12} /> {t("feedback.similar_warn")}
            </div>
            <ul className="space-y-0.5">
              {similar.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/feedback/$id"
                    params={{ id: s.id }}
                    className="text-accent hover:underline"
                    onClick={onClose}
                  >
                    {s.title}
                  </Link>{" "}
                  <Chip className="!text-[10px]">{s.status}</Chip>
                  <span className="text-muted ml-1">
                    ({Math.round(s.similarity * 100)}% {t("feedback.similar_pct")})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormField
          label={t("feedback.body_label")}
          hint={t("feedback.body_hint")}
        >
          <Textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("feedback.body_placeholder")}
          />
        </FormField>
        <FormField label={t("feedback.suggestion_field_label")}>
          <Textarea
            rows={3}
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder={t("feedback.suggestion_placeholder")}
          />
        </FormField>

        <div className="text-[11px] text-muted">
          {t("feedback.current_page")} <code>{url}</code> sẽ được đính kèm tự động.
        </div>
        {err && <Chip variant="danger">{err}</Chip>}
      </div>
    </Modal>
  );
}
