import { createKnowledgeClient } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
/* ==========================================================
   settings.embedding — Cấu hình profile embedding cho Knowledge
   Base. Hỗ trợ Ollama (local) và OpenAI-compatible (cloud). Mỗi
   công ty một profile; lưu vào bảng llm_profiles (kind='embedding').
   Vector cố định 768 chiều — chọn model trả đúng số chiều này.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input, Select } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";

const kb = createKnowledgeClient("");

function EmbeddingSettings() {
  const t = useT();
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
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
      .catch(() => {
        /* chưa đăng nhập */
      });
  }, []);

  const save = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await kb.saveEmbeddingProfile({
        adapter,
        model: model.trim(),
        endpoint: endpoint.trim() || undefined,
        apiKeyEnc: apiKey.trim() || undefined,
      });
      setMsg(t("settings.embedding.save_ok"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">{t("settings.embedding.title")}</h1>
        <div className="text-sm text-muted mb-3">{t("settings.embedding.subtitle")}</div>

        <Card className="space-y-3">
          <FormField label={t("settings.embedding.provider_label")}>
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

          <FormField label={t("settings.embedding.model_label")}>
            <Input
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
              placeholder="nomic-embed-text"
            />
          </FormField>

          <FormField
            label={t("settings.embedding.endpoint_label")}
            hint={
              adapter === "ollama"
                ? t("settings.embedding.endpoint_hint_ollama")
                : t("settings.embedding.endpoint_hint_openai")
            }
          >
            <Input
              value={endpoint}
              disabled={busy}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={
                adapter === "ollama" ? "http://localhost:11434" : "https://api.openai.com"
              }
            />
          </FormField>

          {adapter === "openai" && (
            <FormField
              label={t("settings.embedding.apikey_label")}
              hint={t("settings.embedding.apikey_hint")}
            >
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
            <Button
              variant="primary"
              icon={<I.Save size={14} />}
              disabled={busy || !model.trim() || !canEdit}
              onClick={save}
            >
              {t("settings.embedding.save_btn")}
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
