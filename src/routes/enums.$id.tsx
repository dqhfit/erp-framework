/* ==========================================================
   /enums/$id — Designer enum: nhãn vi/en + danh sách giá trị.
   Mỗi giá trị có { value, label (vi), labelEn? }.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, FormField } from "@/components/ui";
import { I } from "@/components/Icons";
import { createEnumsClient, type EnumValue } from "@erp-framework/client";

const ec = createEnumsClient("");

interface EnumDetail {
  id: string;
  name: string;
  label: string;
  labelEn: string | null;
  description: string | null;
  values: EnumValue[];
  enabled: boolean;
}

function EnumDesigner() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [orig, setOrig] = useState<EnumDetail | null>(null);
  const [label, setLabel] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<EnumValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    ec.get(id).then((r) => {
      const d = r as EnumDetail | null;
      if (!d) return;
      setOrig(d);
      setLabel(d.label);
      setLabelEn(d.labelEn ?? "");
      setDescription(d.description ?? "");
      setValues(d.values ?? []);
    }).catch((e) => setErr((e as Error).message));
  }, [id]);

  const save = async () => {
    if (!orig) return;
    setBusy(true); setErr("");
    try {
      await ec.save({
        name: orig.name,
        label: label.trim() || orig.name,
        labelEn: labelEn.trim() || undefined,
        description: description.trim() || undefined,
        values: values
          .filter((v) => v.value.trim() && v.label.trim())
          .map((v) => ({
            value: v.value.trim(),
            label: v.label.trim(),
            labelEn: v.labelEn?.trim() || undefined,
          })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const addRow = () => setValues((vs) => [...vs, { value: "", label: "", labelEn: "" }]);
  const updRow = (i: number, patch: Partial<EnumValue>) =>
    setValues((vs) => vs.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  const delRow = (i: number) => setValues((vs) => vs.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setValues((vs) => {
      const j = i + dir;
      if (j < 0 || j >= vs.length) return vs;
      const out = [...vs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  if (!orig && !err) return <div className="p-8 text-sm text-muted">Đang tải...</div>;
  if (!orig) return <div className="p-8 text-sm text-danger">{err}</div>;

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-6">
        <div className="flex items-center gap-2 mb-4">
          <Button size="sm" variant="default" icon={<I.ChevronLeft size={14} />}
            onClick={() => void nav({ to: "/enums" })}>Quay lại</Button>
          <h1 className="text-xl font-semibold">{orig.name}</h1>
          <Chip variant={orig.enabled ? "success" : "default"}>
            {orig.enabled ? "Bật" : "Tắt"}
          </Chip>
          <div className="flex-1" />
          <Button size="sm" variant="primary" icon={<I.Save size={14} />}
            disabled={busy} onClick={save}>Lưu</Button>
          {saved && <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> Đã lưu
          </span>}
        </div>

        <Card className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nhãn (vi)">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </FormField>
            <FormField label="Label (en)">
              <Input value={labelEn} placeholder="Optional"
                onChange={(e) => setLabelEn(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Mô tả">
            <Input value={description} placeholder="Ngắn gọn"
              onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </Card>

        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Giá trị</div>
            <Button size="sm" variant="default" icon={<I.Plus size={12} />}
              onClick={addRow}>Thêm giá trị</Button>
          </div>
          {values.length === 0 && (
            <div className="text-sm text-muted italic">Chưa có giá trị nào.</div>
          )}
          {values.length > 0 && (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr_84px] text-[10px] uppercase text-muted bg-panel-2 px-2 py-1.5 gap-2">
                <div>Value (code)</div>
                <div>Nhãn (vi)</div>
                <div>Label (en)</div>
                <div className="text-right">Sửa</div>
              </div>
              {values.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_84px] gap-2 px-2 py-1.5 border-t border-border items-center">
                  <Input className="h-8 text-xs font-mono"
                    placeholder="code" value={v.value}
                    onChange={(e) => updRow(i, { value: e.target.value })} />
                  <Input className="h-8 text-xs"
                    placeholder="Nhãn" value={v.label}
                    onChange={(e) => updRow(i, { label: e.target.value })} />
                  <Input className="h-8 text-xs"
                    placeholder="Label (optional)" value={v.labelEn ?? ""}
                    onChange={(e) => updRow(i, { labelEn: e.target.value })} />
                  <div className="flex items-center gap-1 justify-end">
                    <Button size="sm" variant="ghost" icon={<I.ChevronUp size={10} />}
                      onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" icon={<I.ChevronDown size={10} />}
                      onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<I.Trash size={10} />}
                      onClick={() => delRow(i)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/enums/$id")({
  component: EnumDesigner,
});
