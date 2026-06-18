import { useMemo, useState } from "react";
import { I } from "@/components/Icons";
import type { ColumnGroupNode } from "@/components/renderer/DataGrid";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

interface FieldOpt {
  name: string;
  label: string;
}

/** Trình sửa "Dải cột" (banded header) cho widget List/Table — gom nhiều cột
 *  con dưới 1 dải tiêu đề bao trên (vd "Dán veneer"). Sửa 1 CẤP (dải → cột).
 *  Dải LỒNG (con là 1 dải khác) giữ nguyên, hiện chip khoá, KHÔNG sửa ở đây
 *  (cấu hình tay). Ghi/đọc `cfg.columnGroups` (ColumnGroupNode[]). */
export function BandEditor({
  value,
  availableFields,
  onChange,
}: {
  value: ColumnGroupNode[] | undefined;
  /** Cột widget đang hiện (entity field / khoá phẳng datasource). Rỗng = chưa
   *  xác định được (chưa bind nguồn) → cho nhập tay tên cột. */
  availableFields: FieldOpt[];
  onChange: (next: ColumnGroupNode[] | undefined) => void;
}) {
  const bands = value ?? [];
  // Cho nhập tay tên cột khi không có danh sách (datasource chưa nạp content).
  const [manual, setManual] = useState<Record<number, string>>({});

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of availableFields) m.set(f.name, f.label || f.name);
    return m;
  }, [availableFields]);

  // Field đã nằm trong 1 dải (chỉ con dạng string) — mỗi field thuộc tối đa 1 dải.
  const usedFields = new Set<string>();
  for (const b of bands) for (const c of b.children) if (typeof c === "string") usedFields.add(c);

  const commit = (next: ColumnGroupNode[]) => onChange(next.length ? next : undefined);
  const updateBand = (idx: number, patch: Partial<ColumnGroupNode>) =>
    commit(bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const addBand = () => commit([...bands, { header: "", children: [] }]);
  const removeBand = (idx: number) => commit(bands.filter((_, i) => i !== idx));
  const moveBand = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= bands.length) return;
    const next = [...bands];
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    commit(next);
  };
  const addField = (idx: number, name: string) => {
    const n = name.trim();
    if (!n) return;
    const b = bands[idx];
    if (!b) return;
    if (b.children.some((c) => typeof c === "string" && c === n)) return;
    updateBand(idx, { children: [...b.children, n] });
  };
  const removeChild = (idx: number, childIdx: number) => {
    const b = bands[idx];
    if (!b) return;
    updateBand(idx, { children: b.children.filter((_, i) => i !== childIdx) });
  };

  // Field chưa gắn dải nào — chỉ những field này mới hiện ở dropdown thêm cột.
  const pickable = availableFields.filter((f) => !usedFields.has(f.name));

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted leading-relaxed">
        Gom các cột dưới 1 <b>dải tiêu đề</b> (banded header) như form DQHF. Cột không gắn dải nào
        đứng ngoài, TRƯỚC các dải — theo thứ tự gốc. Kéo viền cột vẫn đổi rộng được kể cả cột nằm
        trong dải.
      </p>

      {bands.map((band, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dải không có id ổn định; thứ tự = key
        <div key={idx} className="rounded-md border border-border bg-bg-soft p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <I.Layers size={13} className="text-accent-2 shrink-0" />
            <Input
              className="flex-1 h-7 text-sm"
              placeholder="Tên dải (vd: Dán veneer)"
              value={band.header}
              onChange={(e) => updateBand(idx, { header: e.target.value })}
            />
            <button
              type="button"
              aria-label="Lên"
              title="Chuyển lên"
              disabled={idx === 0}
              onClick={() => moveBand(idx, -1)}
              className="p-1 rounded text-muted hover:text-text hover:bg-hover/60 disabled:opacity-30"
            >
              <I.ChevronUp size={14} />
            </button>
            <button
              type="button"
              aria-label="Xuống"
              title="Chuyển xuống"
              disabled={idx === bands.length - 1}
              onClick={() => moveBand(idx, 1)}
              className="p-1 rounded text-muted hover:text-text hover:bg-hover/60 disabled:opacity-30"
            >
              <I.ChevronDown size={14} />
            </button>
            <button
              type="button"
              aria-label="Xoá dải"
              title="Xoá dải"
              onClick={() => removeBand(idx)}
              className="p-1 rounded text-muted hover:text-danger hover:bg-danger/10"
            >
              <I.Trash size={14} />
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {band.children.length === 0 && (
              <span className="text-[11px] text-muted/70">Chưa có cột nào trong dải.</span>
            )}
            {band.children.map((c, ci) =>
              typeof c === "string" ? (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: con không có id; (tên+vị trí) đủ phân biệt
                  key={`${c}-${ci}`}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-accent/10 text-accent text-xs"
                >
                  {labelOf.get(c) ?? c}
                  <button
                    type="button"
                    aria-label={`Gỡ ${c}`}
                    onClick={() => removeChild(idx, ci)}
                    className="rounded hover:bg-accent/20 p-0.5"
                  >
                    <I.X size={10} />
                  </button>
                </span>
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: dải lồng không có id
                  key={`grp-${ci}`}
                  title="Dải con lồng — sửa qua cấu hình"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-panel-2 text-muted text-xs opacity-80"
                >
                  <I.Layers size={10} /> {c.header || "(dải con)"}
                </span>
              ),
            )}
          </div>

          {availableFields.length > 0 ? (
            pickable.length > 0 ? (
              <select
                className="input h-7 text-xs w-full"
                value=""
                onChange={(e) => {
                  addField(idx, e.target.value);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">＋ Thêm cột vào dải…</option>
                {pickable.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-muted/70">Mọi cột đã được gắn vào dải.</p>
            )
          ) : (
            // Không có danh sách cột (chưa bind / datasource chưa nạp) → nhập tay.
            <div className="flex items-center gap-1.5">
              <Input
                className="flex-1 h-7 text-xs font-mono"
                placeholder="tên cột (field) rồi Enter…"
                value={manual[idx] ?? ""}
                onChange={(e) => setManual((m) => ({ ...m, [idx]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addField(idx, manual[idx] ?? "");
                    setManual((m) => ({ ...m, [idx]: "" }));
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  addField(idx, manual[idx] ?? "");
                  setManual((m) => ({ ...m, [idx]: "" }));
                }}
                className="px-2 h-7 rounded border border-border text-xs hover:bg-hover/60 shrink-0"
              >
                Thêm
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addBand}
        className={cn(
          "w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md",
          "border border-dashed border-border text-xs text-muted hover:text-accent hover:border-accent/50",
        )}
      >
        <I.Plus size={13} /> Thêm dải
      </button>

      {availableFields.length === 0 && (
        <p className="text-[11px] text-warning/90 leading-relaxed">
          Chưa lấy được danh sách cột của widget (chọn Entity / Nguồn dữ liệu + cột hiển thị ở tab
          “Dữ liệu” trước). Tạm thời nhập tay đúng tên cột (field) để gom dải.
        </p>
      )}
    </div>
  );
}
