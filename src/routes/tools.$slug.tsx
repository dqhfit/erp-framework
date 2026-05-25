/* ==========================================================
   /tools/$slug — Runner kind-aware. Dispatch:
   - web-app  → iframe + spawn lifecycle
   - cli      → action form + output
   - mcp-server → detail (link sang /settings/mcp)
   - plugin   → detail (link sang /settings/plugins)
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, FormField, Textarea } from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createToolsClient,
  type ToolListItem,
  type ToolActionDef,
} from "@erp-framework/client";

const tools = createToolsClient("");

function Runner() {
  const { slug } = Route.useParams();  // slug = tool.id (DB uuid)
  const nav = useNavigate();
  const [tool, setTool] = useState<ToolListItem | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    tools.list()
      .then((arr) => {
        const found = arr.find((t) => t.id === slug || t.slug === slug);
        if (!found) setErr("Tool không tồn tại");
        else setTool(found);
      })
      .catch((e) => setErr((e as Error).message));
  }, [slug, reload]);

  if (err) return (
    <div className="p-6">
      <Chip variant="danger">{err}</Chip>
      <div className="mt-3">
        <Button size="sm" onClick={() => void nav({ to: "/tools" })}
          icon={<I.ChevronLeft size={14} />}>Quay lại</Button>
      </div>
    </div>
  );
  if (!tool) return <div className="p-6 text-sm text-muted">Đang tải…</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Button size="sm" variant="default" icon={<I.ChevronLeft size={14} />}
          onClick={() => void nav({ to: "/tools" })}>Tools</Button>
        <h1 className="font-semibold">{tool.displayName ?? tool.name}</h1>
        <Chip className="!text-[10px]">{tool.kind}</Chip>
        <Chip className="!text-[10px]">{tool.runtime}</Chip>
        <Chip variant={
          tool.status === "running" || tool.status === "mounted" ? "success"
            : tool.status === "error" ? "danger" : "default"
        } className="!text-[10px]">{tool.status}</Chip>
        <div className="flex-1" />
        {!tool.enabledForCompany && (
          <Chip variant="warning" className="!text-[10px]">Chưa bật cho công ty</Chip>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {tool.kind === "web-app" && (
          <WebAppRunner tool={tool} onChange={() => setReload((x) => x + 1)} />
        )}
        {tool.kind === "cli" && <CliRunner tool={tool} />}
        {tool.kind === "mcp-server" && <McpDetail tool={tool} />}
        {tool.kind === "plugin" && <PluginDetail tool={tool} />}
      </div>
    </div>
  );
}

/* ── Web-app runner ──────────────────────────────────────── */
function WebAppRunner({ tool, onChange }: { tool: ToolListItem; onChange: () => void }) {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isSpawn = tool.runtime === "spawn";
  const needsSpawn = isSpawn && tool.status !== "running";

  useEffect(() => {
    tools.getProxyUrl(tool.id)
      .then((r) => setProxyUrl(r.url))
      .catch((e) => setErr((e as Error).message));
  }, [tool.id]);

  // Poll status khi spawn chưa running.
  useEffect(() => {
    if (!needsSpawn) return;
    const id = setInterval(() => onChange(), 1500);
    return () => clearInterval(id);
  }, [needsSpawn, onChange]);

  const spawn = async () => {
    setBusy(true); setErr("");
    try { await tools.spawn(tool.id); onChange(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (needsSpawn) return (
    <div className="flex items-center justify-center h-full">
      <Card className="text-center max-w-sm">
        <I.Power size={28} className="mx-auto text-muted" />
        <div className="mt-2 font-medium">Tool chưa chạy</div>
        <div className="text-xs text-muted mt-1">
          Runtime <code>spawn</code> — bấm Start để framework spawn process.
        </div>
        <Button className="mt-3" variant="primary" disabled={busy}
          onClick={spawn} icon={<I.Play size={14} />}>Start tool</Button>
        {err && <div className="mt-2"><Chip variant="danger">{err}</Chip></div>}
      </Card>
    </div>
  );

  if (!proxyUrl) return <div className="p-6 text-sm text-muted">Đang chuẩn bị URL…</div>;
  if (err) return <div className="p-6"><Chip variant="danger">{err}</Chip></div>;

  // Nhúng iframe — proxy URL cùng-origin với ERP nên cookie/CORS đơn giản.
  return (
    <iframe
      ref={iframeRef}
      src={proxyUrl}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
      title={tool.displayName ?? tool.name}
    />
  );
}

/* ── CLI runner ──────────────────────────────────────────── */
function CliRunner({ tool }: { tool: ToolListItem }) {
  const actions = useMemo<ToolActionDef[]>(
    () => tool.manifest.actions ?? [], [tool],
  );
  const [selected, setSelected] = useState<ToolActionDef | null>(actions[0] ?? null);
  const [argsText, setArgsText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<unknown>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!selected) return;
    setBusy(true); setErr(""); setOutput(null);
    try {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsText || "{}"); }
      catch { throw new Error("args không phải JSON hợp lệ"); }
      const r = await tools.invokeAction({
        toolId: tool.id, action: selected.name, args,
      });
      setOutput(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (actions.length === 0) return (
    <div className="p-6 text-sm text-muted">
      Manifest của tool này không khai báo <code>actions[]</code>.
    </div>
  );

  return (
    <div className="grid grid-cols-3 gap-3 p-4 h-full overflow-y-auto">
      <Card className="space-y-1 col-span-1">
        <div className="font-semibold mb-1">Actions</div>
        {actions.map((a) => (
          <button key={a.name}
            className={"w-full text-left p-2 rounded-md text-sm "
              + (selected?.name === a.name ? "bg-accent/10 text-accent" : "hover:bg-panel-2")}
            onClick={() => setSelected(a)}>
            <div className="font-medium">{a.name}</div>
            {a.description && <div className="text-xs text-muted">{a.description}</div>}
          </button>
        ))}
      </Card>
      <Card className="col-span-2 space-y-3">
        {selected ? (
          <>
            <div className="font-semibold">{selected.name}</div>
            <FormField label="Args (JSON)">
              <Textarea rows={8} className="!font-mono !text-xs"
                value={argsText} onChange={(e) => setArgsText(e.target.value)} />
            </FormField>
            <div className="flex gap-2">
              <Button variant="primary" icon={<I.Play size={14} />}
                disabled={busy} onClick={run}>Invoke</Button>
              {err && <Chip variant="danger">{err}</Chip>}
            </div>
            {output != null && (
              <FormField label="Output">
                <pre className="bg-panel-2 p-2 rounded-md text-xs overflow-auto max-h-80">
                  {JSON.stringify(output, null, 2)}
                </pre>
              </FormField>
            )}
          </>
        ) : (
          <div className="text-sm text-muted">Chọn 1 action ở cột trái.</div>
        )}
      </Card>
    </div>
  );
}

/* ── MCP detail ──────────────────────────────────────────── */
function McpDetail({ tool }: { tool: ToolListItem }) {
  const nav = useNavigate();
  return (
    <div className="p-6 max-w-2xl">
      <Card className="space-y-2">
        <div className="font-semibold">MCP Server tool</div>
        <div className="text-sm text-muted">
          Tool kind <code>mcp-server</code> không có UI trực tiếp — framework
          tự bridge vào bảng <code>mcp_configs</code> với tên{" "}
          <code>tool:{tool.slug}</code>. Agent dùng được tự động qua MCP client.
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {(tool.manifest.actions ?? []).map((a) => (
            <Chip key={a.name}>{a.name}</Chip>
          ))}
        </div>
        <div className="pt-2">
          <Button variant="default" icon={<I.Settings size={14} />}
            onClick={() => void nav({ to: "/settings/mcp" })}>
            Mở Cài đặt MCP
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Plugin detail ───────────────────────────────────────── */
function PluginDetail(_p: { tool: ToolListItem }) {
  const nav = useNavigate();
  return (
    <div className="p-6 max-w-2xl">
      <Card className="space-y-2">
        <div className="font-semibold">Plugin tool</div>
        <div className="text-sm text-muted">
          Tool kind <code>plugin</code> = wrapper admin-UI để dynamic-import 1
          <code> PluginModule</code> rồi feed vào <code>pluginRegistry</code>.
          Disable yêu cầu restart server (Node import cache).
        </div>
        <div className="pt-2">
          <Button variant="default" icon={<I.Package size={14} />}
            onClick={() => void nav({ to: "/settings/plugins" })}>
            Mở Cài đặt Plugins
          </Button>
        </div>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/tools/$slug")({
  component: Runner,
});
