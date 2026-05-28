/* ==========================================================
   MasterPicker — Select dropdown chọn stateKey từ tất cả widget
   đang emit state trên page. Thay cho block "otherLists" cũ
   chỉ hỗ trợ List.
   ========================================================== */
import { groupSources, type StateSource } from "@/lib/page-state-sources";

interface Props {
  sources: StateSource[];
  /** stateKey hiện tại — empty = chưa chọn. */
  value: string;
  onChange: (next: { stateKey: string; source: StateSource | null }) => void;
  placeholder?: string;
  className?: string;
}

export function MasterPicker({
  sources,
  value,
  onChange,
  placeholder = "— Không liên kết —",
  className,
}: Props) {
  const groups = groupSources(sources);
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        const src = sources.find((s) => s.stateKey === v) ?? null;
        onChange({ stateKey: v, source: src });
      }}
      className={
        className ??
        "w-full h-8 px-2 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
      }
    >
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((s) => (
            <option key={s.stateKey} value={s.stateKey}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
