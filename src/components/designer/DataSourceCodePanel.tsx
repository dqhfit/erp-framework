/* ==========================================================
   DataSourceCodePanel — "Tạo nguồn dữ liệu từ code" + Agent AI.
   - Editor DSL (JSON tên-based): base/joins/columns. "Áp dụng"
     compile → DataSourceConfig → lưu store. "Đồng bộ" nạp lại từ
     cấu hình hiện tại (decompile).
   - Agent AI: mô tả tự nhiên → designWithAi("datasource") sinh DSL
     dựa theo DANH MỤC đối tượng thật (tên + field + lookup) → đổ vào
     editor để review rồi Áp dụng. Fail-safe: lỗi LLM/parse không vỡ.
   ========================================================== */

import {
  compileDataSourceDsl,
  type DataSourceConfig,
  type DataSourceDsl,
  type DslEntity,
  decompileToDsl,
} from "@erp-framework/core";
import { useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Select } from "@/components/ui";
import { designWithAi, listLlmProfileNames } from "@/core/ai-design";
import type { MockEntity } from "@/lib/object-types";
import { useUserObjects } from "@/stores/userObjects";

const EMPTY: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

/** MockEntity[] → DslEntity[] (ref id → TÊN đích cho rõ với người + LLM). */
function toDslEntities(entities: MockEntity[]): DslEntity[] {
  const nameById = new Map(entities.map((e) => [e.id, e.name]));
  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    techName: e.techName,
    primaryKey: e.primaryKey
      ? (e.fields.find((f) => f.id === e.primaryKey)?.name ?? undefined)
      : undefined,
    fields: e.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ref: f.ref ? (nameById.get(f.ref) ?? f.ref) : undefined,
    })),
  }));
}

export function DataSourceCodePanel({ id }: { id: string }) {
  const entities = useUserObjects((s) => s.entities);
  const cfg = useUserObjects((s) => s.dataSourceContent[id]) ?? EMPTY;
  const setContent = useUserObjects((s) => s.setDataSourceContent);

  const dslEntities = useMemo(() => toDslEntities(entities), [entities]);

  const [code, setCode] = useState(() =>
    JSON.stringify(decompileToDsl(cfg, toDslEntities(entities)), null, 2),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  /* ── AI agent ── */
  const profiles = useMemo(() => listLlmProfileNames(), []);
  const [profile, setProfile] = useState(profiles[0] ?? "");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);

  const syncFromConfig = () => {
    setCode(JSON.stringify(decompileToDsl(cfg, dslEntities), null, 2));
    setErrors([]);
    setWarnings([]);
    setStatus(null);
  };

  const apply = () => {
    let dsl: DataSourceDsl;
    try {
      dsl = JSON.parse(code) as DataSourceDsl;
    } catch (e) {
      setErrors([`JSON không hợp lệ: ${(e as Error).message}`]);
      setWarnings([]);
      setStatus({ kind: "err", text: "Không parse được code." });
      return;
    }
    const res = compileDataSourceDsl(dsl, dslEntities);
    setErrors(res.errors);
    setWarnings(res.warnings);
    if (res.errors.length > 0) {
      setStatus({ kind: "err", text: `${res.errors.length} lỗi — chưa áp dụng.` });
      return;
    }
    setContent(id, res.config);
    setStatus({
      kind: "ok",
      text: `Đã áp dụng: ${res.config.relations.length} quan hệ · ${res.config.fields.length} cột${
        res.warnings.length ? ` (${res.warnings.length} cảnh báo)` : ""
      }.`,
    });
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const current = cfg.baseEntityId ? decompileToDsl(cfg, dslEntities) : undefined;
      const res = await designWithAi(
        "datasource",
        { prompt: text, current },
        { entityCatalog: dslEntities },
        { profileName: profile || undefined },
      );
      setCode(JSON.stringify(res.data, null, 2));
      setUsage(res.usage);
      // Compile thử ngay để hiện cảnh báo (chưa apply — để user review).
      const compiled = compileDataSourceDsl(res.data, dslEntities);
      setErrors(compiled.errors);
      setWarnings(compiled.warnings);
      setStatus({
        kind: compiled.errors.length ? "err" : "ok",
        text: compiled.errors.length
          ? `AI tạo xong nhưng có ${compiled.errors.length} lỗi — sửa code rồi Áp dụng.`
          : 'AI đã tạo DSL — xem lại rồi bấm "Áp dụng vào cấu hình".',
      });
    } catch (e) {
      setStatus({ kind: "err", text: `Lỗi AI: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      {/* ── Agent AI ── */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
            }}
          >
            <I.Sparkles size={13} />
          </span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-text">Trợ lý AI — tạo nguồn dữ liệu</div>
            <div className="text-[11px] text-muted">
              Mô tả nguồn dữ liệu cần gộp; AI sinh code DSL dựa theo các đối tượng có sẵn.
            </div>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="text-xs text-warning">
            Chưa có LLM profile khả dụng — vào Cài đặt → LLM Profiles để thêm (cần API key hoặc
            bridge).
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted shrink-0">Profile</span>
            <Select
              className="h-7 text-xs w-56"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            {usage && (
              <span className="ml-auto text-[10px] font-mono text-muted">
                {usage.input_tokens}↓ {usage.output_tokens}↑
              </span>
            )}
          </div>
        )}

        <textarea
          className="input font-mono text-sm w-full"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void generate();
            }
          }}
          placeholder="vd: Gộp Đơn hàng + Khách hàng (qua mã KH) + Vùng của khách. Lấy số ĐH, tổng tiền, tên KH, tên vùng."
          disabled={busy || profiles.length === 0}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">Ctrl/⌘ + Enter để gửi</span>
          <Button
            variant="primary"
            size="sm"
            icon={busy ? <I.Loader size={12} className="animate-spin" /> : <I.Sparkles size={12} />}
            onClick={() => void generate()}
            disabled={busy || !prompt.trim() || profiles.length === 0}
          >
            {busy ? "Đang tạo…" : "Tạo bằng AI"}
          </Button>
        </div>
      </Card>

      {/* ── Code editor (DSL) ── */}
      <Card className="p-3 space-y-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-text flex-1">Code (DSL — JSON tên-based)</div>
          <Button
            variant="ghost"
            size="sm"
            icon={<I.Database size={12} />}
            onClick={syncFromConfig}
            title="Nạp lại từ cấu hình hiện tại"
          >
            Đồng bộ
          </Button>
          <Button variant="primary" size="sm" icon={<I.Check size={12} />} onClick={apply}>
            Áp dụng vào cấu hình
          </Button>
        </div>

        <textarea
          className="input font-mono text-xs w-full flex-1 min-h-[220px] resize-none"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />

        {status && (
          <div
            className={`text-xs ${status.kind === "ok" ? "text-success" : "text-danger"} flex items-center gap-1.5`}
          >
            {status.kind === "ok" ? <I.Check size={12} /> : <I.X size={12} />}
            {status.text}
          </div>
        )}
        {errors.length > 0 && (
          <ul className="text-xs text-danger list-disc pl-5 space-y-0.5">
            {errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="text-[11px] text-warning list-disc pl-5 space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted">
          DSL dùng <b>tên đối tượng</b> + <b>alias</b>: <code>base</code> (gốc),{" "}
          <code>joins[]</code> (as/from/fromField/to/toField/kind), <code>columns[]</code>{" "}
          (from/field/as/label/writable). Compile sang cấu hình id-based mà engine dùng — đồng bộ 2
          chiều với tab Cấu hình / Canvas.
        </p>
      </Card>
    </div>
  );
}
