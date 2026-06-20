/* MaterializeEnum — nút + dialog materialize bảng enum vào hệ thống (bảng
   `enums`) + split-rule editor. Tách từ TablesPanel.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import type { ManifestTableRow, SplitEnumRule } from "@/components/migration/manifest-types";
import { Button, Card, Chip, FormField, Input, Modal, TagBox } from "@/components/ui";

const migration = createMigrationClient("");

interface MaterializeSingleResult {
  enumId: string;
  enumName: string;
  enumLabel: string;
  valueCount: number;
  valueColumn: string;
  labelColumn: string;
  extraColumns: string[];
  upserted: "created" | "updated";
}
type MaterializeResult =
  | ({ mode: "single" } & MaterializeSingleResult)
  | { mode: "split"; results: MaterializeSingleResult[] };

export function MaterializeEnumButton({
  tbl,
  moduleName,
}: {
  tbl: ManifestTableRow;
  moduleName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1 border-t border-accent/20">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        icon={<I.Database size={12} />}
      >
        Cấu hình + sinh enum...
      </Button>
      {tbl.splitEnums && tbl.splitEnums.length > 0 && (
        <span className="ml-2 text-[10px] text-accent">
          ⚡ Đang ở chế độ split ({tbl.splitEnums.length} rules)
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Sinh enum: ${tbl.name}`}
        width={780}
      >
        <MaterializeEnumDialog tbl={tbl} moduleName={moduleName} onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

function MaterializeEnumDialog({
  tbl,
  moduleName,
  onDone,
}: {
  tbl: ManifestTableRow;
  moduleName: string;
  onDone: () => void;
}) {
  const cols = (tbl.columns ?? []).map((c) => c.name);
  const initialSplits = tbl.splitEnums ?? [];

  const [mode, setMode] = useState<"single" | "split">(
    initialSplits.length > 0 ? "split" : "single",
  );
  // Single mode state.
  const [singleValueCol, setSingleValueCol] = useState<string>(
    tbl.primaryKey?.[0] ?? cols[0] ?? "",
  );
  const [singleLabelCol, setSingleLabelCol] = useState<string>(
    cols.find((c) => /name|ten|label|mo_ta/i.test(c)) ?? singleValueCol,
  );
  const [singleExtra, setSingleExtra] = useState<string[]>([]);
  // Split mode state.
  const [splitRules, setSplitRules] = useState<SplitEnumRule[]>(initialSplits);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [err, setErr] = useState("");

  // Decision history cho bảng này.
  const [decisions, setDecisions] = useState<
    Array<{ at: string; module: string; action: unknown }>
  >([]);
  useEffect(() => {
    migration
      .decisionsForTable(tbl.name)
      .then((d) => setDecisions(d.slice(-5).reverse()))
      .catch(() => undefined);
  }, [tbl.name]);

  const saveSplitConfig = async (): Promise<void> => {
    await migration.setSplitEnums({
      module: moduleName,
      tableName: tbl.name,
      splitEnums: splitRules,
    });
  };

  const runMaterialize = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      if (mode === "split") {
        await saveSplitConfig();
      } else {
        // Đảm bảo manifest không còn splitEnums cũ nếu user chuyển về single.
        if (initialSplits.length > 0) {
          await migration.setSplitEnums({
            module: moduleName,
            tableName: tbl.name,
            splitEnums: [],
          });
        }
      }
      const r = await migration.materializeEnum({
        module: moduleName,
        tableName: tbl.name,
        ...(mode === "single"
          ? {
              valueColumn: singleValueCol || undefined,
              labelColumn: singleLabelCol || undefined,
              extraColumns: singleExtra.length > 0 ? singleExtra : undefined,
            }
          : {}),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRule = () => {
    setSplitRules([
      ...splitRules,
      {
        discriminatorColumn: cols.find((c) => /loai|type|kind|category/i.test(c)) ?? cols[0] ?? "",
        discriminatorValue: "",
        name: "",
        label: "",
      },
    ]);
  };
  const updateRule = (i: number, patch: Partial<SplitEnumRule>) => {
    setSplitRules(splitRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRule = (i: number) => {
    setSplitRules(splitRules.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Decision history */}
      {decisions.length > 0 && (
        <Card className="p-2 bg-accent/5 border-accent/30">
          <div className="text-accent font-medium mb-1">
            Quyết định trước đó ({decisions.length})
          </div>
          <ul className="text-[10px] text-muted space-y-0.5">
            {decisions.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log quyết định append-only, không có id riêng
              <li key={i}>
                <span>{new Date(d.at).toLocaleString("vi-VN")}</span>
                <span className="ml-2">module={d.module}</span>
                <span className="ml-2">action={(d.action as { type?: string })?.type ?? "?"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "single" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Single enum</div>
          <div className="text-[10px] text-muted">
            Cả bảng = 1 enum. Phù hợp khi bảng chứa 1 loại lookup.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode("split")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "split" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Split (N enum)</div>
          <div className="text-[10px] text-muted">
            1 bảng → nhiều enum theo discriminator column. Vd DM_HE_THONG.
          </div>
        </button>
      </div>

      {mode === "single" ? (
        <Card className="p-3 space-y-2">
          <FormField label="Cột làm `value` (snake_case sau khi sanitize)">
            <ColumnSelect cols={cols} value={singleValueCol} onChange={setSingleValueCol} />
          </FormField>
          <FormField label="Cột làm `label` (hiển thị UI)">
            <ColumnSelect cols={cols} value={singleLabelCol} onChange={setSingleLabelCol} />
          </FormField>
          <FormField label="Extra columns → metadata mỗi value">
            <TagBox
              value={singleExtra}
              onChange={setSingleExtra}
              suggestions={cols}
              placeholder="vd HE_SO_GIA, MA_NHOM..."
            />
            <div className="text-[10px] text-muted mt-1">
              Cột thêm sẽ lưu vào values[].(colName). Vd:{" "}
              <code>{`{value:"vip", label:"VIP", HE_SO_GIA:0.8}`}</code>
            </div>
          </FormField>
        </Card>
      ) : (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">Split rules ({splitRules.length})</div>
            <Button size="sm" variant="default" icon={<I.Plus size={12} />} onClick={addRule}>
              Thêm rule
            </Button>
          </div>
          {splitRules.length === 0 && (
            <div className="text-[11px] text-muted">
              Chưa có rule. Bấm "Thêm rule" để tạo 1 enum theo discriminator.
            </div>
          )}
          {splitRules.map((r, i) => (
            <SplitRuleEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: rule tham chiếu bằng index (update/remove theo i), không có id riêng
              key={i}
              rule={r}
              cols={cols}
              onChange={(patch) => updateRule(i, patch)}
              onRemove={() => removeRule(i)}
            />
          ))}
        </Card>
      )}

      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {/* Result */}
      {result && (
        <Card className="p-3 bg-success/5 border-success/30">
          <div className="font-medium text-success mb-1">
            ✓ Materialize xong — mode {result.mode}
          </div>
          {result.mode === "single" ? (
            <MaterializeResultRow r={result} />
          ) : (
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.enumId}>
                  <MaterializeResultRow r={r} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="default" size="sm" onClick={onDone}>
          Đóng
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={runMaterialize}
          icon={busy ? <I.Loader size={12} /> : <I.Database size={12} />}
        >
          {busy
            ? "Đang sinh..."
            : `Sinh enum ${mode === "split" ? `(${splitRules.length} rules)` : ""}`}
        </Button>
      </div>
    </div>
  );
}

function MaterializeResultRow({ r }: { r: MaterializeSingleResult }) {
  return (
    <div className="text-[11px] flex items-center gap-2 flex-wrap">
      <Chip variant="success" className="text-[10px]!">
        {r.upserted === "created" ? "✓ Tạo mới" : "↻ Cập nhật"} — {r.valueCount} giá trị
      </Chip>
      <a href={`/settings/enums/${r.enumId}`} className="text-accent hover:underline">
        Mở "{r.enumName}" →
      </a>
      <span className="text-muted">
        value=<code>{r.valueColumn}</code> · label=<code>{r.labelColumn}</code>
        {r.extraColumns.length > 0 && <> · extra=[{r.extraColumns.join(", ")}]</>}
      </span>
    </div>
  );
}

function ColumnSelect({
  cols,
  value,
  onChange,
}: {
  cols: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 h-8 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
    >
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function SplitRuleEditor({
  rule,
  cols,
  onChange,
  onRemove,
}: {
  rule: SplitEnumRule;
  cols: string[];
  onChange: (patch: Partial<SplitEnumRule>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border rounded p-2 space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Discriminator column">
          <ColumnSelect
            cols={cols}
            value={rule.discriminatorColumn}
            onChange={(v) => onChange({ discriminatorColumn: v })}
          />
        </FormField>
        <FormField label="Discriminator value">
          <Input
            value={rule.discriminatorValue}
            onChange={(e) => onChange({ discriminatorValue: e.target.value })}
            placeholder="vd TRANG_THAI_DON"
          />
        </FormField>
        <FormField label="Tên enum (snake_case)">
          <Input
            value={rule.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="vd trang_thai_don"
          />
        </FormField>
        <FormField label="Label tiếng Việt">
          <Input
            value={rule.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="vd Trạng thái đơn hàng"
          />
        </FormField>
        <FormField label="Value column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.valueColumn ?? ""}
            onChange={(v) => onChange({ valueColumn: v || undefined })}
          />
        </FormField>
        <FormField label="Label column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.labelColumn ?? ""}
            onChange={(v) => onChange({ labelColumn: v || undefined })}
          />
        </FormField>
      </div>
      <FormField label="Extra columns (optional)">
        <TagBox
          value={rule.extraColumns ?? []}
          onChange={(v) => onChange({ extraColumns: v.length > 0 ? v : undefined })}
          suggestions={cols}
          placeholder="vd HE_SO_GIA, MA_NHOM..."
        />
      </FormField>
      <div className="flex justify-end">
        <Button size="sm" variant="default" onClick={onRemove} icon={<I.Trash size={12} />}>
          Xoá rule
        </Button>
      </div>
    </div>
  );
}

/* ── Panel: procs đầy đủ, expand → load body T-SQL ─────── */
