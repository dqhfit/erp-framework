import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Chip, Button, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import { useActivity, type ActivityKind } from "@/stores/activity";
import { formatUsd } from "@/lib/pricing";
import { dialog } from "@/lib/dialog";

const KIND_LABEL: Record<ActivityKind, string> = {
  create: "Tạo", update: "Cập nhật", delete: "Xoá",
  run_workflow: "Chạy workflow", run_agent: "Chạy agent", mcp_call: "Gọi MCP",
  login: "Đăng nhập", error: "Lỗi",
};

const KIND_VARIANT: Record<ActivityKind, "default" | "accent" | "success" | "warning" | "danger"> = {
  create: "success", update: "accent", delete: "warning",
  run_workflow: "accent", run_agent: "accent", mcp_call: "default",
  login: "default", error: "danger",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex-1">
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </Card>
  );
}

function ActivityDashboard() {
  const entries = useActivity((s) => s.entries);
  const clear = useActivity((s) => s.clear);
  const [filter, setFilter] = useState<string>("all");

  // Tính từ entries — KHÔNG select object tính sẵn. Selector trả về
  // object mới mỗi render → Zustand re-render vô hạn ("Maximum update
  // depth exceeded"). Tính trong thân component thì an toàn.
  const totalCost = entries.reduce((sum, e) => sum + (e.cost ?? 0), 0);
  const totalTokens = entries.reduce(
    (acc, e) => ({
      input: acc.input + (e.tokens?.input ?? 0),
      output: acc.output + (e.tokens?.output ?? 0),
    }),
    { input: 0, output: 0 },
  );

  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const llmCalls = entries.filter((e) => e.kind === "run_agent" || e.kind === "mcp_call").length;

  const handleClear = async () => {
    const ok = await dialog.confirm("Xoá toàn bộ nhật ký hoạt động?", {
      title: "Xoá nhật ký", confirmText: "Xoá", danger: true,
    });
    if (ok) clear();
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1000px] mx-auto p-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">Nhật ký & Chi phí</h1>
          {entries.length > 0 && (
            <Button variant="danger" icon={<I.Trash size={13} />} onClick={handleClear}>
              Xoá nhật ký
            </Button>
          )}
        </div>
        <div className="text-sm text-muted mb-5">
          Theo dõi mọi hành động trong app và chi phí token ước tính.
        </div>

        {/* === Stats === */}
        <div className="flex gap-3 mb-5">
          <Stat label="Tổng chi phí" value={formatUsd(totalCost)} sub={`${llmCalls} lần gọi LLM/MCP`} />
          <Stat label="Token vào" value={totalTokens.input.toLocaleString("vi-VN")} />
          <Stat label="Token ra" value={totalTokens.output.toLocaleString("vi-VN")} />
          <Stat label="Số sự kiện" value={entries.length.toLocaleString("vi-VN")} />
        </div>

        {/* === Filter === */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-muted">Lọc theo loại:</span>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
            <option value="all">Tất cả</option>
            {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </Select>
        </div>

        {/* === Log list === */}
        {shown.length === 0 ? (
          <Card>
            <div className="text-center text-muted py-12 text-sm">
              Chưa có hoạt động nào được ghi nhận.
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide border-b border-border">
                  <th className="text-left py-2 px-3 font-semibold">Thời gian</th>
                  <th className="text-left py-2 px-3 font-semibold">Loại</th>
                  <th className="text-left py-2 px-3 font-semibold">Chi tiết</th>
                  <th className="text-right py-2 px-3 font-semibold">Token</th>
                  <th className="text-right py-2 px-3 font-semibold">Chi phí</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-hover/40">
                    <td className="py-2 px-3 text-muted whitespace-nowrap font-mono text-xs">
                      {fmtTime(e.at)}
                    </td>
                    <td className="py-2 px-3">
                      <Chip variant={KIND_VARIANT[e.kind]}>{KIND_LABEL[e.kind]}</Chip>
                    </td>
                    <td className="py-2 px-3">
                      <div>{e.detail}</div>
                      {e.target && (
                        <div className="text-xs text-muted">
                          {e.objectType ? `${e.objectType}: ` : ""}{e.target}
                          {e.model ? ` · ${e.model}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-muted whitespace-nowrap">
                      {e.tokens ? `${e.tokens.input}/${e.tokens.output}` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">
                      {e.cost != null ? formatUsd(e.cost) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/activity")({ component: ActivityDashboard });
