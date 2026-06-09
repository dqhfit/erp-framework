/* ==========================================================
   FilterBuilder — UI cây AND/OR cho cấu hình cfg.filters của
   widget consumer. Render đệ quy FilterNode.
   ========================================================== */
import { MasterPicker } from "@/components/designer/inspectors/MasterPicker";
import { I } from "@/components/Icons";
import type { StateSource } from "@/lib/page-state-sources";
import type { FilterLeaf, FilterNode, FilterOp } from "@/types/page";

interface EntityField {
  name: string;
  label: string;
  type?: string;
}

const OP_OPTIONS: Array<{ value: FilterOp; label: string }> = [
  { value: "eq", label: "bằng" },
  { value: "neq", label: "khác" },
  { value: "contains", label: "chứa" },
  { value: "in", label: "thuộc danh sách" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "between", label: "trong khoảng" },
  { value: "isEmpty", label: "rỗng" },
  { value: "isNotEmpty", label: "không rỗng" },
];

function defaultLeaf(): FilterLeaf {
  return { kind: "leaf", field: "", stateKey: "", op: "eq" };
}

function defaultGroup(): FilterNode {
  return { kind: "group", logic: "and", children: [defaultLeaf()] };
}

interface Props {
  /** Cây filter hiện tại (cfg.filters). Null = chưa cấu hình. */
  value: FilterNode | null | undefined;
  onChange: (next: FilterNode | null) => void;
  sources: StateSource[];
  entityFields: EntityField[];
  /** Callback khi user chọn source là List → auto-assign selectionStateKey. */
  onPickSource?: (src: StateSource | null) => void;
}

export function FilterBuilder({ value, onChange, sources, entityFields, onPickSource }: Props) {
  if (!value) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-center space-y-2">
        <div className="text-[11px] text-muted leading-snug text-left">
          Lọc dữ liệu của widget theo giá trị lấy từ widget khác (Combobox, Search, dòng đang
          chọn…). Mỗi điều kiện so sánh{" "}
          <span className="font-medium text-text">field của widget này</span> với{" "}
          <span className="font-medium text-text">giá trị từ một nguồn</span>; gộp nhiều điều kiện
          bằng AND/OR.
        </div>
        <button
          type="button"
          onClick={() => onChange(defaultGroup())}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-accent/15 hover:bg-accent/25 text-accent font-medium"
        >
          <I.Plus size={11} /> Bắt đầu cấu hình
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <NodeRenderer
        node={value}
        path={[]}
        onChange={(next) => onChange(next)}
        sources={sources}
        entityFields={entityFields}
        onPickSource={onPickSource}
      />
      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-[11px] text-muted hover:text-danger"
      >
        Xoá toàn bộ filter nâng cao
      </button>
    </div>
  );
}

/* ─────────────────────────── Node renderer ─────────────── */
interface NodeProps {
  node: FilterNode;
  path: number[];
  onChange: (next: FilterNode) => void;
  onRemove?: () => void;
  sources: StateSource[];
  entityFields: EntityField[];
  onPickSource?: (src: StateSource | null) => void;
}

function NodeRenderer(props: NodeProps) {
  if (props.node.kind === "group") return <GroupNode {...props} node={props.node} />;
  return <LeafNode {...props} node={props.node} />;
}

function GroupNode({
  node,
  onChange,
  onRemove,
  sources,
  entityFields,
  onPickSource,
}: NodeProps & { node: { kind: "group"; logic: "and" | "or"; children: FilterNode[] } }) {
  const depth = 0; // Hiện chưa dùng — có thể truyền path để indent.
  const update = (children: FilterNode[]) => onChange({ ...node, children });
  const toggleLogic = () => onChange({ ...node, logic: node.logic === "and" ? "or" : "and" });
  return (
    <div className="border border-border rounded-md bg-panel-2/50">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50">
        <button
          type="button"
          onClick={toggleLogic}
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${node.logic === "and" ? "bg-accent/20 text-accent" : "bg-warning/20 text-warning"}`}
          title="Click để đổi AND ↔ OR"
        >
          {node.logic}
        </button>
        <span className="text-[10px] text-muted">{node.children.length} điều kiện</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => update([...node.children, defaultLeaf()])}
          className="text-[10px] text-muted hover:text-text flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-hover"
          title="Thêm điều kiện"
        >
          <I.Plus size={10} /> điều kiện
        </button>
        <button
          type="button"
          onClick={() => update([...node.children, defaultGroup()])}
          className="text-[10px] text-muted hover:text-text flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-hover"
          title="Thêm nhóm con"
        >
          <I.Plus size={10} /> nhóm
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted hover:text-danger p-0.5"
            title="Xoá nhóm"
          >
            <I.X size={11} />
          </button>
        )}
      </div>
      <div className={`p-2 space-y-2 ${depth === 0 ? "" : "pl-3"}`}>
        {node.children.length === 0 ? (
          <div className="text-[11px] text-muted text-center py-2">
            Nhóm trống — thêm điều kiện hoặc nhóm con.
          </div>
        ) : (
          node.children.map((c, i) => (
            <NodeRenderer
              // biome-ignore lint/suspicious/noArrayIndexKey: FilterNode không có id ổn định; reorder hiếm trong cây nhỏ
              key={i}
              node={c}
              path={[i]}
              onChange={(next) => {
                const arr = [...node.children];
                arr[i] = next;
                update(arr);
              }}
              onRemove={() => {
                const arr = [...node.children];
                arr.splice(i, 1);
                update(arr);
              }}
              sources={sources}
              entityFields={entityFields}
              onPickSource={onPickSource}
            />
          ))
        )}
      </div>
    </div>
  );
}

function LeafNode({
  node,
  onChange,
  onRemove,
  sources,
  entityFields,
  onPickSource,
}: NodeProps & { node: FilterLeaf }) {
  const update = (patch: Partial<FilterLeaf>) => onChange({ ...node, ...patch });

  const needsState = node.op !== "isEmpty" && node.op !== "isNotEmpty";

  return (
    <div className="border border-border rounded-md bg-bg p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {/* Field của entity widget */}
        <select
          value={node.field}
          onChange={(e) => update({ field: e.target.value })}
          className="flex-1 h-7 px-1.5 border border-border rounded bg-bg text-xs outline-none focus:border-accent"
        >
          <option value="">— Field —</option>
          {entityFields.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
        </select>
        {entityFields.length === 0 && (
          <span className="text-[10px] text-warning shrink-0" title="Không có field để chọn">
            chọn Entity có field
          </span>
        )}
        {/* Operator */}
        <select
          value={node.op}
          onChange={(e) => update({ op: e.target.value as FilterOp })}
          className="h-7 px-1.5 border border-border rounded bg-bg text-xs outline-none focus:border-accent w-[110px]"
        >
          {OP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted hover:text-danger p-0.5"
            title="Xoá điều kiện"
          >
            <I.X size={11} />
          </button>
        )}
      </div>
      {needsState && (
        <MasterPicker
          sources={sources}
          value={node.stateKey}
          onChange={({ stateKey, source }) => {
            onPickSource?.(source);
            update({ stateKey });
          }}
          placeholder="— Nguồn giá trị —"
          className="w-full h-7 px-1.5 border border-border rounded bg-bg text-xs outline-none focus:border-accent"
        />
      )}
    </div>
  );
}
