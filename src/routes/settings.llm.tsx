import { createConfigClient } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { LlmProfileCard } from "@/components/settings/LlmProfileCard";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { ClaudeCliAdapter } from "@/core/llm/claude-cli";
import { getTokens, isLoggedIn, logout, startLogin } from "@/core/llm/oauth";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";

function LlmSettings() {
  const t = useT();
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const profiles = useSettings((s) => s.llmProfiles);
  const setProfile = useSettings((s) => s.setLlmProfile);
  const deleteProfile = useSettings((s) => s.deleteLlmProfile);
  const [newName, setNewName] = useState("");
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(
    localStorage.getItem("claude-cli-bridge-url") || "http://localhost:8909",
  );
  const checkBridge = () => ClaudeCliAdapter.healthCheck(bridgeUrl).then(setBridgeOk);

  // Đồng bộ LLM profile với backend (router llm.* → PostgreSQL).
  const config = useMemo(() => createConfigClient(""), []);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  const saveProfilesToServer = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const all = Object.values(useSettings.getState().llmProfiles);
      for (const pr of all) {
        await config.saveLlm({
          name: pr.name,
          adapter: pr.adapter,
          model: pr.model,
          endpoint: pr.endpoint,
          apiKeyEnc: pr.apiKey,
          temperature: pr.temperature,
          maxTokens: pr.max_tokens,
        });
      }
      setSyncMsg(`✓ Đã lưu ${all.length} profile lên server`);
    } catch (e) {
      setSyncMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const loadProfilesFromServer = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const rows = await config.listLlm();
      const cur = useSettings.getState();
      Object.keys(cur.llmProfiles).forEach((n) => {
        cur.deleteLlmProfile(n);
      });
      for (const r of rows) {
        cur.setLlmProfile({
          name: r.name,
          adapter: r.adapter,
          model: r.model,
          endpoint: r.endpoint ?? undefined,
          // Không lưu masked sentinel vào local store — key được giữ trên server.
          apiKey: undefined,
          temperature: r.temperature ?? undefined,
          max_tokens: r.maxTokens ?? undefined,
        });
      }
      setSyncMsg(`✓ Đã tải ${rows.length} profile từ server`);
    } catch (e) {
      setSyncMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Recheck login status (e.g. after callback)
  useEffect(() => {
    const check = () => setLoggedIn(isLoggedIn());
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  const handleAdd = () => {
    if (!newName.trim()) return;
    setProfile({
      name: newName.trim(),
      adapter: "claude",
      model: "claude-sonnet-4-6",
      temperature: 0.7,
      max_tokens: 4096,
    });
    setNewName("");
  };

  const handleLogin = async () => {
    const ok = await dialog.confirm(
      "Sẽ chuyển bạn sang Claude.ai để đăng nhập tài khoản Pro/Max.\n\n" +
        "Lưu ý: token được lưu vào localStorage trong trình duyệt.\n" +
        "Tiếp tục?",
      { title: "Đăng nhập Claude Pro/Max", confirmText: "Tiếp tục" },
    );
    if (!ok) return;
    startLogin().catch((e) => dialog.alert(`Lỗi: ${e.message}`, { title: "Đăng nhập thất bại" }));
  };

  const handleLogout = async () => {
    const ok = await dialog.confirm("Đăng xuất Claude Pro/Max?", {
      title: "Đăng xuất",
      confirmText: "Đăng xuất",
      danger: true,
    });
    if (!ok) return;
    logout();
    setLoggedIn(false);
  };

  const tokens = getTokens();
  const expiresAt = tokens ? new Date(tokens.expires_at) : null;

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">{t("settings.llm.title")}</h1>
        <div className="text-sm text-muted mb-6">{t("settings.llm.subtitle")}</div>

        {/* === Claude Pro/Max OAuth === */}
        <Card className="mb-4 border-accent/40">
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
              }}
            >
              <I.Sparkles size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2">
                Claude Pro / Max
                {loggedIn ? (
                  <Chip variant="success">✓ Đã đăng nhập</Chip>
                ) : (
                  <Chip>Chưa đăng nhập</Chip>
                )}
              </div>
              <div className="text-sm text-muted mt-1">
                Dùng quota của gói subscription Claude Pro hoặc Max thay vì trả tiền API tokens.
                {loggedIn && expiresAt && (
                  <>
                    {" "}
                    Token hết hạn lúc{" "}
                    <span className="font-mono">{expiresAt.toLocaleString("vi-VN")}</span> (tự
                    refresh).
                  </>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {loggedIn ? (
                  <>
                    <Button
                      variant="primary"
                      icon={<I.Sparkles size={13} />}
                      disabled={!canEdit}
                      onClick={async () => {
                        const pr = {
                          name: "Claude Pro",
                          adapter: "claude-pro",
                          model: "claude-sonnet-4-6",
                          temperature: 0.7,
                          max_tokens: 4096,
                        };
                        setProfile(pr);
                        try {
                          await config.saveLlm({
                            name: pr.name,
                            adapter: pr.adapter,
                            model: pr.model,
                            temperature: pr.temperature,
                            maxTokens: pr.max_tokens,
                          });
                          dialog.alert("Đã tạo và lưu profile 'Claude Pro' lên server.", {
                            title: "Thành công",
                          });
                        } catch {
                          dialog.alert(
                            "Đã tạo profile 'Claude Pro' nhưng chưa lưu lên server. Nhấn 'Lưu lên server' để đồng bộ.",
                            { title: "Tạo thành công" },
                          );
                        }
                      }}
                    >
                      Tạo profile "Claude Pro"
                    </Button>
                    <Button variant="danger" icon={<I.Power size={13} />} onClick={handleLogout}>
                      Đăng xuất
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" icon={<I.Sparkles size={13} />} onClick={handleLogin}>
                    Đăng nhập với Claude Pro/Max
                  </Button>
                )}
                <a
                  href="https://claude.ai/upgrade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline ml-auto"
                >
                  Chưa có gói Pro? Nâng cấp ở claude.ai →
                </a>
              </div>
            </div>
          </div>
        </Card>

        {/* === Claude Code CLI Bridge === */}
        <Card className="mb-4 border-accent-2/40">
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(var(--accent-2)), hsl(var(--accent)))",
              }}
            >
              <I.Server size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2">
                Claude Code CLI Bridge
                {bridgeOk === true ? (
                  <Chip variant="success">✓ Bridge online</Chip>
                ) : bridgeOk === false ? (
                  <Chip variant="danger">✗ Bridge offline</Chip>
                ) : (
                  <Chip>Chưa kiểm tra</Chip>
                )}
              </div>
              <div className="text-sm text-muted mt-1">
                Dùng <code className="font-mono text-accent-2">claude</code> CLI làm backend. Tận
                dụng auth Pro/Max trong CLI mà không phải cấu hình lại.
              </div>
              <div className="mt-3 text-xs bg-bg-soft p-3 rounded-md border border-border space-y-1">
                <div className="text-muted">Cài đặt:</div>
                <div className="font-mono">
                  1. <code className="text-accent">npm install -g @anthropic-ai/claude-code</code>
                </div>
                <div className="font-mono">
                  2. <code className="text-accent">claude</code> → login Pro/Max
                </div>
                <div className="font-mono">
                  3. <code className="text-accent">pnpm bridge</code> → khởi động bridge
                </div>
              </div>
              <div className="mt-3 flex items-end gap-2">
                <FormField label="Bridge URL" hint="Mặc định localhost:8909">
                  <Input
                    value={bridgeUrl}
                    onChange={(e) => {
                      setBridgeUrl(e.target.value);
                      localStorage.setItem("claude-cli-bridge-url", e.target.value);
                    }}
                    placeholder="http://localhost:8909"
                  />
                </FormField>
                <Button variant="primary" icon={<I.Power size={13} />} onClick={checkBridge}>
                  Test
                </Button>
                <Button
                  variant="default"
                  disabled={!canEdit}
                  onClick={async () => {
                    const pr = {
                      name: "Claude CLI",
                      adapter: "claude-cli",
                      model: "claude-sonnet-4-6",
                      endpoint: bridgeUrl,
                      temperature: 0.7,
                      max_tokens: 4096,
                    };
                    setProfile(pr);
                    try {
                      await config.saveLlm({
                        name: pr.name,
                        adapter: pr.adapter,
                        model: pr.model,
                        endpoint: pr.endpoint,
                        temperature: pr.temperature,
                        maxTokens: pr.max_tokens,
                      });
                      dialog.alert("Đã tạo và lưu profile 'Claude CLI' lên server.", {
                        title: "Thành công",
                      });
                    } catch {
                      dialog.alert(
                        "Đã tạo profile 'Claude CLI' nhưng chưa lưu lên server. Nhấn 'Lưu lên server' để đồng bộ.",
                        { title: "Tạo thành công" },
                      );
                    }
                  }}
                >
                  + Tạo profile
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* === Lưu danh sách profile lên backend (PostgreSQL) === */}
        <Card className="mb-4">
          <div className="font-semibold mb-1">Lưu LLM profile lên server</div>
          <div className="text-xs text-muted mb-3">
            Toàn bộ profile lưu vào PostgreSQL (bảng <span className="font-mono">llm_profiles</span>
            ) qua backend. Cần đăng nhập (vào trang "Dữ liệu Server"); chỉ admin mới lưu được.
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="primary"
              icon={<I.Save size={14} />}
              disabled={syncing || !canEdit}
              onClick={saveProfilesToServer}
            >
              Lưu lên server
            </Button>
            <Button
              variant="default"
              icon={<I.Eye size={14} />}
              disabled={syncing}
              onClick={loadProfilesFromServer}
            >
              Tải từ server
            </Button>
            {syncMsg && (
              <Chip variant={syncMsg.startsWith("✓") ? "success" : "danger"}>{syncMsg}</Chip>
            )}
          </div>
        </Card>

        {/* === New profile form (manual API key) === */}
        <Card className="mb-4">
          <div className="flex gap-2 items-end">
            <FormField
              label="Tên profile mới"
              hint="VD: default / cheap / vision / local — dùng API key"
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="default"
              />
            </FormField>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={!canEdit}
              icon={<I.Plus size={14} />}
            >
              Thêm
            </Button>
          </div>
        </Card>

        {/* === Profile list === */}
        <div className="space-y-3">
          {Object.values(profiles).map((p) => (
            <LlmProfileCard
              key={p.name}
              profile={p}
              loggedInClaudePro={loggedIn}
              onChange={(next) => setProfile(next)}
              onDelete={() => deleteProfile(p.name)}
              readOnly={!canEdit}
            />
          ))}
          {Object.keys(profiles).length === 0 && (
            <Card>
              <div className="text-center text-muted py-8 text-sm">
                Chưa có profile. Đăng nhập Claude Pro/Max ở trên, hoặc thêm profile mới bằng API
                key.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/llm")({ component: LlmSettings });
