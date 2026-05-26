import { I } from "@/components/Icons";
import { ModelCombobox } from "@/components/ModelCombobox";
/* ==========================================================
   LlmProfileCard — Card 1 LLM profile dùng useDynamicModels
   để load model list động từ API.
   ========================================================== */
import { Button, Card, Chip, FormField, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { LLMProfile } from "@/types/llm";

const ADAPTERS = ["claude", "claude-pro", "claude-cli", "openai", "gemini", "ollama"] as const;
const NO_KEY_ADAPTERS = new Set(["claude-pro", "claude-cli", "ollama"]);

interface Props {
  profile: LLMProfile;
  loggedInClaudePro: boolean;
  onChange: (next: LLMProfile) => void;
  onDelete: () => void;
  readOnly?: boolean;
}

export function LlmProfileCard({
  profile: p,
  loggedInClaudePro,
  onChange,
  onDelete,
  readOnly = false,
}: Props) {
  // useDynamicModels được gọi trong ModelCombobox — không cần ở đây nữa.

  return (
    <Card>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">{p.name}</h3>
          <Chip variant="accent">{p.adapter}</Chip>
          {p.adapter === "claude-pro" ? (
            loggedInClaudePro ? (
              <Chip variant="success">✓ OAuth token</Chip>
            ) : (
              <Chip variant="warning">⚠ Chưa đăng nhập</Chip>
            )
          ) : p.adapter === "claude-cli" ? (
            <Chip variant="accent">via bridge</Chip>
          ) : p.adapter === "ollama" ? (
            <Chip variant="accent">local model</Chip>
          ) : p.apiKey ? (
            <Chip variant="success">✓ API key</Chip>
          ) : (
            <Chip variant="warning">⚠ Chưa có key</Chip>
          )}
        </div>
        {!readOnly && (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (
                await dialog.confirm(`Xóa profile "${p.name}"?`, {
                  title: "Xóa LLM profile",
                  confirmText: "Xóa",
                  danger: true,
                })
              )
                onDelete();
            }}
            icon={<I.Trash size={12} />}
          >
            Xóa
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Adapter">
          <Select
            value={p.adapter}
            disabled={readOnly}
            onChange={(e) => onChange({ ...p, adapter: e.target.value, model: "" })}
          >
            {ADAPTERS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Model" hint={`Adapter: ${p.adapter}`}>
          <ModelCombobox
            value={p.model || ""}
            onChange={(m) => onChange({ ...p, model: m })}
            lockedAdapter={p.adapter}
          />
        </FormField>

        {!NO_KEY_ADAPTERS.has(p.adapter) && (
          <FormField label="API Key" hint="Lưu trong localStorage, không gửi đi đâu khác">
            <Input
              type="password"
              value={p.apiKey ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange({ ...p, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </FormField>
        )}
        {p.adapter !== "claude-pro" && (
          <FormField
            label={
              p.adapter === "claude-cli"
                ? "Bridge URL"
                : p.adapter === "ollama"
                  ? "Ollama URL"
                  : "Endpoint"
            }
            hint={
              p.adapter === "claude-cli"
                ? "Mặc định http://localhost:8909"
                : p.adapter === "ollama"
                  ? "Mặc định http://localhost:11434"
                  : "Để trống dùng mặc định"
            }
          >
            <Input
              value={p.endpoint ?? ""}
              onChange={(e) => onChange({ ...p, endpoint: e.target.value })}
              placeholder={
                p.adapter === "claude-cli"
                  ? "http://localhost:8909"
                  : p.adapter === "ollama"
                    ? "http://localhost:11434"
                    : "Auto"
              }
            />
          </FormField>
        )}
        {p.adapter === "claude-pro" && (
          <FormField label="Auth" hint="Token tự refresh khi hết hạn">
            <div className="h-9 px-3 flex items-center text-sm border border-border rounded-md bg-bg-soft">
              {loggedInClaudePro
                ? "✓ OAuth bearer token (auto-refresh)"
                : "⚠ Hãy đăng nhập ở thẻ trên"}
            </div>
          </FormField>
        )}
        <FormField label={`Temperature (${p.temperature ?? 0.7})`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={p.temperature ?? 0.7}
            disabled={readOnly}
            onChange={(e) => onChange({ ...p, temperature: Number.parseFloat(e.target.value) })}
            className="w-full accent-[hsl(var(--accent))]"
          />
        </FormField>
        <FormField label="Max tokens">
          <Input
            type="number"
            value={p.max_tokens ?? 4096}
            disabled={readOnly}
            onChange={(e) => onChange({ ...p, max_tokens: Number.parseInt(e.target.value, 10) })}
          />
        </FormField>
      </div>
    </Card>
  );
}
