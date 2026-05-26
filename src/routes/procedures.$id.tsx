import { createProceduresClient } from "@erp-framework/client";
/* ==========================================================
   /procedures/$id — Designer: viết code + test run + lưu.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input, Textarea } from "@/components/ui";

const procs = createProceduresClient("");

interface ProcDetail {
  id: string;
  name: string;
  label: string;
  description: string | null;
  paramsSchema: Array<Record<string, unknown>>;
  returnSchema: Record<string, unknown> | null;
  code: string;
  enabled: boolean;
}

function ProcedureDesigner() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [proc, setProc] = useState<ProcDetail | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [testResult, setTestResult] = useState<string>("");

  useEffect(() => {
    procs
      .get(id)
      .then((p) => {
        const r = p as ProcDetail | null;
        if (!r) return;
        setProc(r);
        setLabel(r.label);
        setDescription(r.description ?? "");
        setCode(r.code);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  const save = async () => {
    if (!proc) return;
    setBusy(true);
    setErr("");
    try {
      await procs.save({
        name: proc.name,
        label: label.trim() || proc.name,
        description: description.trim() || undefined,
        code,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setErr("");
    setTestResult("");
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsText || "{}");
      } catch {
        throw new Error("args không phải JSON hợp lệ");
      }
      const r = await procs.test(code, args);
      setTestResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!proc && !err) return <div className="p-8 text-sm text-muted">Đang tải...</div>;
  if (!proc) return <div className="p-8 text-sm text-danger">{err}</div>;

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-6">
        <div className="flex items-center gap-2 mb-4">
          <Button
            size="sm"
            variant="default"
            icon={<I.ChevronLeft size={14} />}
            onClick={() => void nav({ to: "/procedures" })}
          >
            Quay lại
          </Button>
          <h1 className="text-xl font-semibold">{proc.name}</h1>
          <Chip variant={proc.enabled ? "success" : "default"}>{proc.enabled ? "Bật" : "Tắt"}</Chip>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="primary"
            icon={<I.Save size={14} />}
            disabled={busy}
            onClick={save}
          >
            Lưu
          </Button>
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <I.Check size={11} /> Đã lưu
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card className="space-y-3">
            <FormField label="Nhãn">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </FormField>
            <FormField label="Mô tả">
              <Input
                value={description}
                placeholder="Ngắn gọn, hiển thị trong list"
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <FormField label="Code (JS)">
              <Textarea
                rows={20}
                className="font-mono! text-xs! leading-relaxed"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </FormField>
            <div className="text-[11px] text-muted leading-relaxed">
              API: <code>args</code>, <code>db.queryRecords / findById</code>,{" "}
              <code>entity.insert / update / delete</code>, <code>callTool</code>,{" "}
              <code>callProc</code>, <code>fetch</code>, <code>console.log</code>.<br />
              Timeout 5s, RAM 128MB. Mọi op scope theo công ty.
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="font-semibold flex items-center gap-2">
              <I.Play size={14} /> Test run
            </div>
            <FormField label="args (JSON)">
              <Textarea
                rows={4}
                className="font-mono! text-xs!"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </FormField>
            <Button
              variant="primary"
              size="sm"
              icon={<I.Bolt size={12} />}
              disabled={busy}
              onClick={test}
            >
              Chạy thử
            </Button>
            <FormField label="Kết quả">
              <Textarea
                rows={16}
                readOnly
                className="font-mono! text-xs! bg-bg-soft!"
                value={testResult}
              />
            </FormField>
          </Card>
        </div>

        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/procedures/$id")({
  component: ProcedureDesigner,
});
