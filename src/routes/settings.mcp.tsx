import { createConfigClient } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input, Select } from "@/components/ui";
import { McpClient, type McpConfig } from "@/core/mcp";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";

function McpSettings() {
  const t = useT();
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const mcp = useSettings((s) => s.mcp);
  const setMcp = useSettings((s) => s.setMcp);
  const [headersJson, setHeadersJson] = useState(JSON.stringify(mcp.headers ?? {}, null, 2));
  const [testResult, setTestResult] = useState<string>("");
  const [testing, setTesting] = useState(false);

  // Client gọi backend (router mcp.*) — config lưu trong PostgreSQL.
  const config = useMemo(() => createConfigClient(""), []);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  const handleTest = async () => {
    setTesting(true);
    setTestResult("");
    try {
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(headersJson);
      } catch {
        /* ignore */
      }
      const client = new McpClient({ ...mcp, headers });
      const tools = await client.connect();
      setTestResult(`✓ Kết nối thành công — ${tools.length} tools`);
    } catch (e) {
      setTestResult(`✗ Lỗi: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const persistHeaders = () => {
    try {
      const headers = JSON.parse(headersJson);
      setMcp({ ...mcp, headers });
    } catch {
      /* invalid JSON, ignore */
    }
  };

  // Snapshot cấu hình hiện tại (đồng bộ headers từ textarea).
  const buildCurrent = (): McpConfig => {
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(headersJson);
    } catch {
      /* ignore */
    }
    return { ...mcp, headers };
  };

  const applyConfig = (cfg: McpConfig) => {
    setMcp(cfg);
    setHeadersJson(JSON.stringify(cfg.headers ?? {}, null, 2));
  };

  const saveToServer = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      await config.saveMcp(buildCurrent());
      setSyncMsg("✓ Đã lưu lên server");
    } catch (e) {
      setSyncMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const loadFromServer = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const cfg = await config.getMcp();
      if (cfg) {
        applyConfig(cfg as McpConfig);
        setSyncMsg("✓ Đã tải từ server");
      } else {
        setSyncMsg("✗ Server chưa có cấu hình MCP");
      }
    } catch (e) {
      setSyncMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[720px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">{t("settings.mcp.title")}</h1>
        <div className="text-sm text-muted mb-3">{t("settings.mcp.subtitle")}</div>

        {/* === MCP config === */}
        <Card className="space-y-4 mb-4">
          <FormField label={t("settings.mcp.mode")}>
            <Select
              value={mcp.mode}
              onChange={(e) => setMcp({ ...mcp, mode: e.target.value as "demo" | "http" })}
            >
              <option value="demo">{t("settings.mcp.mode_demo")}</option>
              <option value="http">{t("settings.mcp.mode_http")}</option>
            </Select>
          </FormField>
          {mcp.mode === "http" && (
            <>
              <FormField label={t("settings.mcp.url")} hint={t("settings.mcp.url_hint")}>
                <Input
                  value={mcp.url ?? ""}
                  placeholder="https://your-mcp-server/mcp"
                  onChange={(e) => setMcp({ ...mcp, url: e.target.value })}
                />
              </FormField>
              <FormField label="Headers JSON" hint='Vd: {"Authorization": "Bearer ..."}'>
                <textarea
                  className="input font-mono"
                  rows={4}
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  onBlur={persistHeaders}
                />
              </FormField>
            </>
          )}
          <div className="flex gap-2 items-center pt-2 border-t border-border">
            <Button
              variant="primary"
              onClick={handleTest}
              icon={<I.Power size={14} />}
              disabled={testing || !canEdit}
            >
              {testing ? t("settings.mcp.test_busy") : t("settings.mcp.test_btn")}
            </Button>
            {testResult && (
              <Chip variant={testResult.startsWith("✓") ? "success" : "danger"}>{testResult}</Chip>
            )}
          </div>
        </Card>

        {/* === Lưu cấu hình lên backend (PostgreSQL) === */}
        <Card>
          <div className="font-semibold mb-1">Lưu MCP config lên server</div>
          <div className="text-xs text-muted mb-3">
            Mode, URL, headers lưu vào PostgreSQL (bảng{" "}
            <span className="font-mono">mcp_configs</span>) qua backend — dùng chung giữa nhiều máy.
            Cần đăng nhập (vào trang "Dữ liệu Server" để đăng nhập); chỉ admin mới lưu được.
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="primary"
              icon={<I.Save size={14} />}
              disabled={syncing || !canEdit}
              onClick={saveToServer}
            >
              Lưu lên server
            </Button>
            <Button
              variant="default"
              icon={<I.Eye size={14} />}
              disabled={syncing}
              onClick={loadFromServer}
            >
              Tải từ server
            </Button>
            {syncMsg && (
              <Chip variant={syncMsg.startsWith("✓") ? "success" : "danger"}>{syncMsg}</Chip>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/mcp")({ component: McpSettings });
