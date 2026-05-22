/* ==========================================================
   settings.embedding — Cấu hình profile embedding cho Knowledge
   Base. Hỗ trợ Ollama (local) và OpenAI-compatible (cloud). Mỗi
   công ty một profile; lưu vào bảng llm_profiles (kind='embedding').
   Vector cố định 768 chiều — chọn model trả đúng số chiều này.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Select, FormField } from "@/components/ui";
import { I } from "@/components/Icons";
import { createKnowledgeClient } from "@erp-framework/client";

const kb = createKnowledgeClient("");

function EmbeddingSettings() {
  const [adapter, setAdapter] = useState<"ollama" | "openai">("ollama");
  const [model, setModel] = useState("nomic-embed-text");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    kb.getEmbeddingProfile()
      .then((p) => {
        if (!p) return;
        setAdapter(p.adapter === "openai" ? "openai" : "ollama");
        setModel(p.model);
        setEndpoint(p.endpoint ?? "");
        setApiKey(p.apiKeyEnc ?? "");
      })
      .catch(() => { /* chưa đăng nhập */ });
  }, []);

  const save = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await kb.saveEmbeddingProfile({
        adapter,
        model: model.trim(),
        endpoint: endpoint.trim() || undefined,
        apiKeyEnc: apiKey.trim() || undefined,
      });
      setMsg("Đã lưu cấu hình embedding.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Cấu hình Embedding</h1>
        <div className="text-sm text-muted mb-6">
          Profile sinh embedding cho Knowledge Base. Vector cố định{" "}
          <span className="font-mono">768</span> chiều — chọn model trả đúng số
          chiều này (Ollama <span className="font-mono">nomic-embed-text</span>,
          OpenAI <span className="font-mono">text-embedding-3-small</span>).
        </div>

        <Card className="space-y-3">
          <FormField label="Nhà cung cấp">
            <Select
              value={adapter}
              disabled={busy}
              onChange={(e) => {
                const a = e.target.value as "ollama" | "openai";
                setAdapter(a);
                setModel(a === "openai" ? "text-embedding-3-small" : "nomic-embed-text");
              }}
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI-compatible (cloud)</option>
            </Select>
          </FormField>

          <FormField label="Model">
            <Input
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
              placeholder="nomic-embed-text"
            />
          </FormField>

          <FormField
            label="Endpoint"
            hint={adapter === "ollama"
              ? "Để trống dùng http://localhost:11434"
              : "Để trống dùng https://api.openai.com. Gemini: nhập URL OpenAI-compat."}
          >
            <Input
              value={endpoint}
              disabled={busy}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={adapter === "ollama"
                ? "http://localhost:11434"
                : "https://api.openai.com"}
            />
          </FormField>

          {adapter === "openai" && (
            <FormField label="API Key" hint="Mã hoá AES-256-GCM trước khi lưu vào DB">
              <Input
                type="password"
                value={apiKey}
                disabled={busy}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </FormField>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="primary" icon={<I.Save size={14} />}
              disabled={busy || !model.trim()} onClick={save}>
              Lưu cấu hình
            </Button>
            {msg && <Chip variant="success">{msg}</Chip>}
            {err && <Chip variant="danger">{err}</Chip>}
          </div>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/embedding")({
  component: EmbeddingSettings,
});
