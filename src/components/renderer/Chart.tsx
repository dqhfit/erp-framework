import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

export type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut";

export interface ChartProps {
  kind: ChartKind;
  data: Array<Record<string, unknown>>;
  /** Key cột làm label/x. Tự detect nếu không truyền. */
  labelKey?: string;
  /** Key cột giá trị. Tự detect nếu không truyền (cột số đầu tiên). */
  valueKeys?: string[];
  className?: string;
  title?: string;
}

const PALETTE = [
  "#7c5cff",
  "#00d4ff",
  "#22c55e",
  "#ff9933",
  "#ff5577",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#facc15",
];

function detect(data: Array<Record<string, unknown>>, labelKey?: string, valueKeys?: string[]) {
  // length === 0 → guarded return ngay; sample sau đó luôn có.
  const sample = data[0];
  if (!sample) return { lk: "", vks: [] };
  const keys = Object.keys(sample);
  const lk = labelKey ?? keys.find((k) => typeof sample[k] !== "number") ?? keys[0] ?? "";
  const numKeys = keys.filter((k) => k !== lk && typeof sample[k] === "number");
  const vks = valueKeys ?? (numKeys.length ? numKeys : keys.slice(1, 2));
  return { lk, vks };
}

export function Chart({ kind, data, labelKey, valueKeys, className, title }: ChartProps) {
  const { lk, vks } = detect(data, labelKey, valueKeys);

  if (!data.length) {
    return (
      <div
        className={cn(
          "h-full w-full flex items-center justify-center text-muted text-sm",
          className,
        )}
      >
        Không có dữ liệu cho biểu đồ.
      </div>
    );
  }

  /* Lấp đầy chiều cao khung: tiêu đề cố định, vùng đồ hoạ co giãn (flex-1).
     ResponsiveContainer height="100%" → chỉ phần plot co theo khung, còn
     trục/legend/nhãn giữ nguyên cỡ chữ nên LUÔN đọc được, không bị cắt. */
  return (
    <div className={cn("w-full h-full flex flex-col min-h-0", className)}>
      {title && <div className="text-sm font-semibold mb-2 shrink-0">{title}</div>}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis dataKey={lk} tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <YAxis tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--panel))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {vks.map((k, i) => (
                <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </BarChart>
          ) : kind === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis dataKey={lk} tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <YAxis tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--panel))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {vks.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : kind === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis dataKey={lk} tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <YAxis tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--panel))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {vks.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={0.3}
                />
              ))}
            </AreaChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey={vks[0] ?? "value"}
                nameKey={lk}
                outerRadius={kind === "doughnut" ? "80%" : "85%"}
                innerRadius={kind === "doughnut" ? "50%" : 0}
                labelLine={false}
                label={(e) => `${e.name}: ${e.value}`}
              >
                {data.map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--panel))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
