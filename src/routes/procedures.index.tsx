import { createProceduresClient } from "@erp-framework/client";
/* ==========================================================
   /procedures — Danh sách native procedure.
   Native procedure = JS chạy server (isolated-vm) với db/entity
   bindings. Dùng thay stored proc MSSQL / MCP tool tính toán.
   ========================================================== */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Drawer, Input, Switch, Textarea } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const procs = createProceduresClient("");

interface ProcRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updatedAt: string;
}

function ProcedureGuide() {
  return (
    <div className="p-5 space-y-6 text-sm">
      {/* Tổng quan */}
      <section className="space-y-2">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <I.Terminal size={15} className="text-accent" /> Thủ tục là gì?
        </h2>
        <p className="text-muted leading-relaxed">
          Thủ tục (Procedure) là đoạn JavaScript chạy <strong>server-side</strong> trong sandbox
          cách ly (<code className="bg-panel-2 px-1 rounded text-xs">isolated-vm</code>). Dùng thay
          stored procedure MSSQL — có thể truy cập DB, gọi entity API, gọi MCP tool hoặc HTTP
          external. Được gọi từ workflow, tRPC, hoặc entity binding.
        </p>
        <div className="flex flex-wrap gap-2 mt-1">
          {[
            "Tính toán nghiệp vụ phức tạp",
            "Truy vấn + tổng hợp nhiều entity",
            "Gọi API bên ngoài",
            "Tạo / cập nhật hàng loạt trong 1 transaction",
          ].map((t) => (
            <span key={t} className="chip chip-accent text-xs">
              {t}
            </span>
          ))}
        </div>
      </section>

      <hr className="border-border" />

      {/* Cú pháp cơ bản */}
      <section className="space-y-2">
        <h2 className="font-semibold">Cú pháp cơ bản</h2>
        <pre className="bg-panel-2 border border-border rounded-md p-3 text-[12px] font-mono overflow-x-auto leading-relaxed whitespace-pre">{`// Code của bạn là body của async function
// Có thể dùng await ở bất kỳ đâu

const rows = await db.queryRecords("orders", { status: "pending" });

if (rows.length === 0) {
  return { count: 0, message: "Không có đơn hàng chờ" };
}

// Giá trị return phải serializable (JSON)
return { count: rows.length, ids: rows.map(r => r.id) };`}</pre>
        <ul className="text-muted text-xs space-y-1 mt-2">
          <li>
            • <code className="bg-panel-2 px-1 rounded">return</code> — bắt buộc, giá trị trả về
            phải JSON-serializable
          </li>
          <li>
            • <code className="bg-panel-2 px-1 rounded">throw new Error("...")</code> — báo lỗi cho
            caller
          </li>
          <li>
            • <strong>Không có</strong> <code className="bg-panel-2 px-1 rounded">process</code>,{" "}
            <code className="bg-panel-2 px-1 rounded">require</code>,{" "}
            <code className="bg-panel-2 px-1 rounded">import</code>
          </li>
        </ul>
      </section>

      <hr className="border-border" />

      {/* Biến có sẵn */}
      <section className="space-y-4">
        <h2 className="font-semibold">Biến có sẵn</h2>

        {/* args */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              args
            </code>
            <span className="text-muted text-xs">Record&lt;string, unknown&gt;</span>
          </div>
          <p className="text-muted text-xs pl-2">
            Tham số đầu vào từ caller. Khai báo schema ở tab <em>Tham số</em> để validate tự động.
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`const { orderId, discount } = args;
if (!orderId) throw new Error("orderId là bắt buộc");`}</pre>
        </div>

        {/* db.queryRecords */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              db.queryRecords
            </code>
            <span className="text-muted text-xs">(entityName, filter?, opts?) → Row[]</span>
          </div>
          <p className="text-muted text-xs pl-2">
            Truy vấn records của entity. <code className="bg-panel-2 px-1 rounded">filter</code> là
            object JSON match (containment @&gt;).
            <code className="bg-panel-2 px-1 rounded ml-1">opts</code>:{" "}
            <code className="bg-panel-2 px-1 rounded">{"{ limit?: number, offset?: number }"}</code>{" "}
            (limit tối đa 1000).
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`// Lấy đơn hàng trạng thái "pending", tối đa 50
const rows = await db.queryRecords("orders",
  { status: "pending" },
  { limit: 50 }
);
// rows[0] = { id, data: {...}, createdAt, updatedAt }`}</pre>
        </div>

        {/* db.findById */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              db.findById
            </code>
            <span className="text-muted text-xs">(entityName, id) → Row | null</span>
          </div>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`const order = await db.findById("orders", args.orderId);
if (!order) throw new Error("Không tìm thấy đơn hàng");
const total = order.data.total;`}</pre>
        </div>

        {/* db.tx */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              db.tx
            </code>
            <span className="text-muted text-xs">(async callback) → kết quả callback</span>
          </div>
          <p className="text-muted text-xs pl-2">
            Chạy nhiều thao tác trong 1 transaction. Throw trong callback → rollback toàn bộ.
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`return await db.tx(async () => {
  await entity.update("orders", orderId, { status: "approved" });
  await entity.insert("audit_log", {
    action: "approve_order",
    targetId: orderId,
  });
  return { success: true };
});`}</pre>
        </div>

        {/* entity.insert / update / delete */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap gap-y-1">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              entity.insert
            </code>
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              entity.update
            </code>
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              entity.delete
            </code>
          </div>
          <p className="text-muted text-xs pl-2">
            Ghi dữ liệu entity — đi qua{" "}
            <code className="bg-panel-2 px-1 rounded">validateRecord</code> (required, unique, type
            check).
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`// Tạo record mới
const rec = await entity.insert("invoices", {
  order_id: args.orderId,
  amount:   args.amount,
  issued_at: new Date().toISOString(),
});

// Cập nhật
await entity.update("invoices", rec.id, { status: "sent" });

// Xoá
await entity.delete("invoices", args.invoiceId);`}</pre>
        </div>

        {/* callTool */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              callTool
            </code>
            <span className="text-muted text-xs">(name, args) → unknown</span>
          </div>
          <p className="text-muted text-xs pl-2">Gọi MCP tool đã kết nối với công ty.</p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`const result = await callTool("crm.getCustomer", {
  customerId: args.customerId
});
return { name: result.name, email: result.email };`}</pre>
        </div>

        {/* callProc */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              callProc
            </code>
            <span className="text-muted text-xs">(name, args) → unknown</span>
          </div>
          <p className="text-muted text-xs pl-2">
            Gọi thủ tục khác (cycle-protected, độ sâu tối đa 8). Tên là{" "}
            <code className="bg-panel-2 px-1 rounded">name</code> của thủ tục.
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`const tax = await callProc("calc_vat", { amount: subtotal });
return { subtotal, tax: tax.value, total: subtotal + tax.value };`}</pre>
        </div>

        {/* fetch */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              fetch
            </code>
            <span className="text-muted text-xs">(url, init?) → {"{ ok, status, text }"}</span>
          </div>
          <p className="text-muted text-xs pl-2">
            HTTP request ra ngoài. Admin cần set biến môi trường{" "}
            <code className="bg-panel-2 px-1 rounded">
              CODE_NODE_FETCH_ALLOWLIST=api.example.com,webhook.site
            </code>{" "}
            (comma-separated hostnames) để cho phép. Khi allowlist rỗng — tất cả bị block.
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`const res = await fetch("https://api.exchange.com/rate", {
  method: "GET",
  headers: { Authorization: "Bearer " + args.token }
});
if (!res.ok) throw new Error("API lỗi: " + res.status);
const data = JSON.parse(res.text);
return { usdRate: data.usd_vnd };`}</pre>
        </div>

        {/* console */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="bg-accent/10 text-accent px-2 py-0.5 rounded font-mono text-xs font-semibold">
              console.log
            </code>
            <span className="text-muted text-xs">(...args) → void</span>
          </div>
          <p className="text-muted text-xs pl-2">
            Ghi log — xuất hiện ở tab <em>Logs</em> khi test chạy procedure.
          </p>
          <pre className="bg-panel-2 border border-border rounded-md p-2 text-[11px] font-mono">{`console.log("Đang xử lý orderId:", args.orderId);
const rows = await db.queryRecords("orders");
console.log("Tổng đơn hàng:", rows.length);`}</pre>
        </div>
      </section>

      <hr className="border-border" />

      {/* Giới hạn sandbox */}
      <section className="space-y-2">
        <h2 className="font-semibold">Giới hạn Sandbox</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Timeout", "5 giây (CODE_NODE_TIMEOUT_MS)"],
            ["RAM", "128 MB (CODE_NODE_MEM_MB)"],
            ["Độ sâu callProc", "Tối đa 8 cấp"],
            ["fetch", "Chỉ host trong allowlist"],
            ["Bị chặn", "process, require, import, eval"],
            ["Scope", "Luôn cách ly theo company"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col p-2 rounded-md border border-border bg-bg-soft">
              <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {k}
              </span>
              <span className="text-xs mt-0.5">{v}</span>
            </div>
          ))}
        </div>
      </section>

      <hr className="border-border" />

      {/* Ví dụ tổng hợp */}
      <section className="space-y-2">
        <h2 className="font-semibold">Ví dụ: Tổng hợp doanh thu tháng</h2>
        <pre className="bg-panel-2 border border-border rounded-md p-3 text-[11px] font-mono overflow-x-auto leading-relaxed whitespace-pre">{`// Tham số: { year: number, month: number }
const { year, month } = args;
if (!year || !month) throw new Error("Thiếu year hoặc month");

// Lấy tất cả đơn hàng đã hoàn thành trong tháng
const orders = await db.queryRecords("orders",
  { status: "completed" },
  { limit: 1000 }
);

// Filter theo tháng/năm ở code (DB không có index date)
const filtered = orders.filter(r => {
  const d = new Date(r.data.completed_at ?? r.createdAt);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
});

const total = filtered.reduce(
  (sum, r) => sum + (Number(r.data.total) || 0), 0
);

console.log(\`Tháng \${month}/\${year}: \${filtered.length} đơn, tổng \${total}\`);

return {
  year, month,
  orderCount: filtered.length,
  revenue: total,
};`}</pre>
      </section>
    </div>
  );
}

function ProceduresList() {
  const nav = useNavigate();
  const [list, setList] = useState<ProcRow[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  // AI generator state.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const load = () => {
    procs
      .list()
      .then((r) => setList(r as ProcRow[]))
      .catch(() => {
        /* ignore */
      });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      if (ok) setMsg(ok);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    void run(async () => {
      const n = name.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(n)) {
        throw new Error("Tên phải snake_case bắt đầu bằng chữ.");
      }
      await procs.save({
        name: n,
        label: label.trim() || n,
        code: "// Hàm procedure. Truy cập: args, db, entity, callTool, fetch, console.\nreturn { hello: args.name ?? 'world' };",
      });
      setName("");
      setLabel("");
    }, "✓ Đã tạo procedure.");

  const doDelete = async (p: ProcRow) => {
    const ok = await dialog.confirm(`Xoá thủ tục "${p.name}"?`, {
      title: "Xoá thủ tục",
      confirmText: "Xoá",
    });
    if (ok) void run(() => procs.delete(p.id), "✓ Đã xoá.");
  };

  /** Gọi AI → preview code → confirm → save → nav tới /procedures/$id. */
  const generateAi = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 5) return;
    setAiBusy(true);
    setErr("");
    setMsg("");
    try {
      const draft = await procs.generateAi(prompt);
      // Preview: name + label + 1 dòng đầu code + đếm dòng total
      const lines = draft.code.split("\n");
      const codePreview =
        lines.slice(0, 4).join("\n") +
        (lines.length > 4 ? `\n  … (${lines.length - 4} dòng nữa)` : "");
      const paramsPreview =
        draft.paramsSchema.length > 0
          ? `\n\nTham số (${draft.paramsSchema.length}):\n${draft.paramsSchema
              .map(
                (p, i) =>
                  `  ${i + 1}. ${String((p as { name?: string }).name ?? "?")}: ${String((p as { type?: string }).type ?? "?")}`,
              )
              .join("\n")}`
          : "";
      const preview = `Tên: ${draft.name}\nNhãn: ${draft.label}${draft.description ? `\nMô tả: ${draft.description}` : ""}${paramsPreview}\n\nCode (${lines.length} dòng):\n${codePreview}`;
      const ok = await dialog.confirm(preview, {
        title: "AI đề xuất Thủ tục — duyệt rồi lưu?",
        confirmText: "Lưu",
      });
      if (!ok) {
        setAiBusy(false);
        return;
      }
      const saved = (await procs.save({
        name: draft.name,
        label: draft.label,
        description: draft.description,
        paramsSchema: draft.paramsSchema,
        code: draft.code,
      })) as { id: string };
      setAiPrompt("");
      setMsg("✓ Đã tạo thủ tục từ AI. Mở để test + chỉnh sửa.");
      load();
      if (saved?.id) void nav({ to: "/procedures/$id", params: { id: saved.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <Drawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Hướng dẫn viết Thủ tục"
        width={580}
      >
        <ProcedureGuide />
      </Drawer>
      <div className="max-w-[820px] mx-auto p-3 sm:p-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-sm font-semibold">Thủ tục</h1>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted hover:text-text hover:bg-hover border border-border transition-colors"
            title="Xem hướng dẫn viết thủ tục"
          >
            <I.HelpCircle size={13} />
            Hướng dẫn
          </button>
        </div>
        <div className="text-sm text-muted mb-3">
          Thủ tục (procedure) JS chạy server-side với truy cập DB. Thay stored proc MSSQL — invoke
          từ workflow, tRPC, hoặc entity binding.
        </div>

        <Card className="mb-4 space-y-2 bg-accent/5 border-accent/20">
          <div className="font-semibold flex items-center gap-1">
            <I.Sparkles size={14} className="text-accent" /> Tạo bằng AI
          </div>
          <div className="text-xs text-muted">
            Mô tả tác vụ — AI tự sinh tên + tham số + code JS. Bạn duyệt preview, lưu, rồi mở chi
            tiết để test.
          </div>
          <Textarea
            rows={3}
            value={aiPrompt}
            disabled={aiBusy}
            placeholder='VD: "Tính tổng doanh thu theo tháng từ entity orders, trả về mảng {month, total}"'
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <Button
            variant="primary"
            icon={<I.Sparkles size={14} />}
            disabled={aiBusy || aiPrompt.trim().length < 5}
            onClick={generateAi}
          >
            {aiBusy ? "Đang sinh…" : "Sinh bằng AI"}
          </Button>
        </Card>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Thủ tục đã đăng ký</div>
          {list.length === 0 && <div className="text-sm text-muted">Chưa có thủ tục nào.</div>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Terminal size={15} className="text-muted shrink-0" />
              <Link
                to="/procedures/$id"
                params={{ id: p.id }}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>
              <span className="text-xs text-muted truncate">{p.label}</span>
              <Chip variant={p.enabled ? "success" : "default"}>{p.enabled ? "Bật" : "Tắt"}</Chip>
              <div className="flex-1" />
              <Switch
                checked={p.enabled}
                onChange={(v) =>
                  void run(() => procs.setEnabled(p.id, v).then(() => {}), "✓ Đã cập nhật.")
                }
              />
              <Button
                size="sm"
                variant="danger"
                icon={<I.Trash size={12} />}
                disabled={busy}
                onClick={() => void doDelete(p)}
              />
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <div className="font-semibold">Tạo thủ tục thủ công</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="name (snake_case)"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Nhãn hiển thị"
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            icon={<I.Plus size={14} />}
            disabled={busy || !name.trim()}
            onClick={create}
          >
            Tạo
          </Button>
          <div className="text-xs text-muted">
            Sau khi tạo, mở thủ tục để viết code và test run.
          </div>
        </Card>

        {msg && (
          <div className="mt-4">
            <Chip variant="success">{msg}</Chip>
          </div>
        )}
        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/procedures/")({
  component: ProceduresList,
});
