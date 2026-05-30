/* ==========================================================
   MyLlmProfiles — Mục "Mô hình cá nhân của tôi" trong Cài đặt LLM.
   Mỗi tài khoản tự cấu hình model riêng (llm.listMine/saveMine/deleteMine,
   approvedProcedure — không cần quyền admin).
   - runtime="server": server tự gọi (API cloud / bridge server với tới).
   - runtime="browser": model LOCAL trên máy user (Ollama/claude-cli localhost),
     chỉ client-side dùng; server bỏ qua, fallback profile công ty.
   Resolve khi chạy AI: ưu tiên profile cá nhân (runtime=server) → công ty.
   ========================================================== */
import { createConfigClient } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, FormField, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";

const ADAPTERS = ["claude", "claude-pro", "claude-cli", "openai", "gemini", "ollama"] as const;
const NO_KEY = new Set(["claude-pro", "claude-cli", "ollama"]);

interface MineRow {
  name: string;
  adapter: string;
  model: string;
  runtime: string;
  endpoint: string | null;
  hasApiKey: boolean;
}

const EMPTY = {
  name: "",
  adapter: "claude-cli",
  model: "claude-sonnet-4-6",
  runtime: "browser" as "server" | "browser",
  endpoint: "",
  apiKey: "",
};

export function MyLlmProfiles() {
  const config = useMemo(() => createConfigClient(""), []);
  const [rows, setRows] = useState<MineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    config
      .listLlmMine()
      .then((r) => setRows(r as MineRow[]))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần
  useEffect(reload, []);

  const edit = (r: MineRow) =>
    setForm({
      name: r.name,
      adapter: r.adapter,
      model: r.model,
      runtime: (r.runtime === "browser" ? "browser" : "server") as "server" | "browser",
      endpoint: r.endpoint ?? "",
      apiKey: "",
    });

  const save = async () => {
    if (!form.name.trim() || !form.model.trim()) {
      toast.info("Cần tên profile và model.");
      return;
    }
    setSaving(true);
    try {
      await config.saveLlmMine({
        name: form.name.trim(),
        adapter: form.adapter,
        model: form.model.trim(),
        runtime: form.runtime,
        endpoint: form.endpoint.trim() || undefined,
        apiKeyEnc: form.apiKey.trim() || undefined,
      });
      toast.success(`Đã lưu profile cá nhân "${form.name.trim()}".`);
      setForm({ ...EMPTY });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    const ok = await dialog.confirm(`Xoá profile cá nhân "${name}"?`, {
      title: "Xoá profile",
      danger: true,
      confirmText: "Xoá",
    });
    if (!ok) return;
    try {
      await config.deleteLlmMine(name);
      toast.success("Đã xoá.");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const needsKey = !NO_KEY.has(form.adapter);

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <I.User size={14} /> Mô hình cá nhân của tôi
        </h2>
        <p className="text-xs text-muted mt-0.5">
          Mỗi tài khoản tự cấu hình model riêng. Khi chạy AI, ưu tiên profile cá nhân (chạy trên
          server) rồi mới đến profile chung của công ty. Model "trên máy tôi" chỉ trình duyệt của
          bạn gọi được.
        </p>
      </div>

      {/* Danh sách */}
      {loading ? (
        <div className="text-xs text-muted py-2">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted py-2">Chưa có profile cá nhân nào.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1.5 hover:bg-bg-soft/40"
            >
              <span className="font-mono font-semibold">{r.name}</span>
              <span className="text-muted">
                {r.adapter} · {r.model}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  r.runtime === "browser"
                    ? "bg-warning/15 text-warning border-warning/30"
                    : "bg-accent/15 text-accent border-accent/30"
                }`}
                title={
                  r.runtime === "browser"
                    ? "Model local trên máy bạn — chỉ trình duyệt gọi"
                    : "Server gọi được"
                }
              >
                {r.runtime === "browser" ? "máy tôi" : "server"}
              </span>
              {r.hasApiKey && <I.Key size={11} className="text-success" />}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => edit(r)}
                  className="text-muted hover:text-accent p-1 rounded hover:bg-accent/10"
                  title="Sửa"
                >
                  <I.Edit size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.name)}
                  className="text-muted hover:text-danger p-1 rounded hover:bg-danger/10"
                  title="Xoá"
                >
                  <I.Trash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form thêm/sửa */}
      <div className="border-t border-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FormField label="Tên profile">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="vd: Ollama máy tôi"
          />
        </FormField>
        <FormField label="Adapter">
          <Select
            value={form.adapter}
            onChange={(e) => setForm((f) => ({ ...f, adapter: e.target.value }))}
          >
            {ADAPTERS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Model">
          <Input
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="vd: llama3 / claude-sonnet-4-6"
          />
        </FormField>
        <FormField label="Nơi chạy">
          <Select
            value={form.runtime}
            onChange={(e) =>
              setForm((f) => ({ ...f, runtime: e.target.value as "server" | "browser" }))
            }
          >
            <option value="server">Trên server (API/bridge server với tới)</option>
            <option value="browser">Trên máy tôi (model local, browser gọi)</option>
          </Select>
        </FormField>
        <FormField label="Endpoint (tuỳ chọn)">
          <Input
            value={form.endpoint}
            onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
            placeholder="http://localhost:11434"
          />
        </FormField>
        {needsKey && (
          <FormField label="API key (để trống = giữ nguyên)">
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder="••••••"
            />
          </FormField>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={<I.Check size={12} />}
          onClick={save}
          disabled={saving}
        >
          {saving ? "Đang lưu…" : "Lưu profile cá nhân"}
        </Button>
        {form.name && (
          <Button size="sm" variant="ghost" onClick={() => setForm({ ...EMPTY })}>
            Huỷ
          </Button>
        )}
      </div>
    </Card>
  );
}
