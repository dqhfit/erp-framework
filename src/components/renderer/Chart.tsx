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
  height?: number | string;
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
  if (!data.length) return { lk: "", vks: [] };
  const sample = data[0]!;
  const keys = Object.keys(sample);
  const lk = labelKey ?? keys.find((k) => typeof sample[k] !== "number") ?? keys[0]!;
  const numKeys = keys.filter((k) => k !== lk && typeof sample[k] === "number");
  const vks = valueKeys ?? (numKeys.length ? numKeys : keys.slice(1, 2));
  return { lk, vks };
}

export function Chart({
  kind,
  data,
  labelKey,
  valueKeys,
  className,
  height = 300,
  title,
}: ChartProps) {
  const { lk, vks } = detect(data, labelKey, valueKeys);

  if (!data.length) {
    return (
      <div
        className={cn("flex items-center justify-center text-muted text-sm py-8", className)}
        style={{ height }}
      >
        Không có dữ liệu cho biểu đồ.
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      {title && <div className="text-sm font-semibold mb-2">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
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
              outerRadius={kind === "doughnut" ? 100 : 110}
              innerRadius={kind === "doughnut" ? 60 : 0}
              labelLine={false}
              label={(e) => `${e.name}: ${e.value}`}
            >
              {data.map((_, i) => (
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
  );
}
