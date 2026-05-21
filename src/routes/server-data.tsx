/* server-data.tsx — Demo nối frontend với backend THẬT.
   Qua Vite proxy (/trpc cùng origin). Thao tác: xác thực, định
   nghĩa entity + field, tạo record (validate-on-write), cấu hình
   MCP — tất cả lưu trong PostgreSQL, không localStorage. */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Button, Input, Select, Card, FormField, Textarea } from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createApiDataSource, createAuthClient, createConfigClient,
} from "@erp-framework/client";
import type { EntityConfig, EntityRecord } from "@erp-framework/core";

interface SessionUser {
  email: string;
  name: string;
  role: string;
}

function ServerData() {
  const auth = useMemo(() => createAuthClient(""), []);
  const data = useMemo(() => createApiDataSource(""), []);
  const config = useMemo(() => createConfigClient(""), []);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [entities, setEntities] = useState<EntityConfig[]>([]);
  const [selected, setSelected] = useState<EntityConfig | null>(null);
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [mcpJson, setMcpJson] = useState("{}");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [entityName, setEntityName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<"text" | "number">("text");
  const [recordForm, setRecordForm] = useState<Record<string, string>>({});

  const loadEntities = useCallback(async () => {
    try {
      setEntities(await data.listEntities());
    } catch (e) {
      setStatus("Lỗi tải entity: " + (e as Error).message);
    }
  }, [data]);

  const loadRecords = useCallback(async (entityId: string) => {
    try {
      const res = await data.getRecords(entityId);
      setRecords(res.rows);
    } catch (e) {
      setStatus("Lỗi tải record: " + (e as Error).message);
    }
  }, [data]);

  const loadMcp = useCallback(async () => {
    try {
      const cfg = await config.getMcp();
      setMcpJson(JSON.stringify(cfg ?? {}, null, 2));
    } catch { /* chưa có cấu hình MCP */ }
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    auth.me()
      .then((u) => { if (!cancelled) setUser(u); })
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, [auth]);

  useEffect(() => {
    if (user) {
      void loadEntities();
      void loadMcp();
    } else {
      setEntities([]);
      setSelected(null);
    }
  }, [user, loadEntities, loadMcp]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setStatus(`${label} lỗi: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

  const doRegister = () => run("Đăng ký", async () => {
    await auth.register(email, name, password);
    setStatus("Đã tạo tài khoản admin đầu tiên — giờ bấm Đăng nhập.");
  });
  const doLogin = () => run("Đăng nhập", async () => {
    setUser(await auth.login(email, password));
    setStatus("Đăng nhập thành công.");
  });
  const doLogout = () => run("Đăng xuất", async () => {
    await auth.logout();
    setUser(null);
  });

  const createEntity = () => run("Tạo entity", async () => {
    const label = entityName.trim();
    if (!label) return;
    await data.saveEntity({ id: "", name: slugify(label), label, fields: [] });
    setEntityName("");
    await loadEntities();
    setStatus(`Đã tạo entity "${label}".`);
  });

  const selectEntity = (en: EntityConfig) => {
    setSelected(en);
    setRecordForm({});
    setRecords([]);
    void loadRecords(en.id);
  };

  const addField = () => run("Thêm field", async () => {
    if (!selected) return;
    const fl = fieldName.trim();
    if (!fl) return;
    const updated: EntityConfig = {
      ...selected,
      fields: [...selected.fields, { name: slugify(fl), label: fl, type: fieldType }],
    };
    const saved = await data.saveEntity(updated);
    setSelected(saved);
    await loadEntities();
    setFieldName("");
    setStatus(`Đã thêm field "${fl}".`);
  });

  const createRecord = () => run("Tạo record", async () => {
    if (!selected) return;
    const obj: Record<string, unknown> = {};
    for (const f of selected.fields) {
      const v = recordForm[f.name];
      if (v !== undefined && v !== "") obj[f.name] = v;
    }
    await data.createRecord(selected.id, obj);
    setRecordForm({});
    await loadRecords(selected.id);
    setStatus("Đã tạo record.");
  });

  const saveMcp = () => run("Lưu MCP", async () => {
    await config.saveMcp(JSON.parse(mcpJson) as Record<string, unknown>);
    setStatus("Đã lưu cấu hình MCP vào PostgreSQL.");
  });

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Dữ liệu Server</h1>
        <div className="text-sm text-muted mb-5">
          Demo nối frontend với backend thật (Fastify + tRPC + PostgreSQL) qua
          Vite proxy. Entity, field, record, cấu hình MCP đều lưu trong DB.
        </div>

        {status && (
          <div className="text-sm mb-4 px-3 py-2 rounded-md border border-border bg-bg-soft">
            {status}
          </div>
        )}

        {!user ? (
          <Card>
            <div className="font-semibold mb-1">Đăng nhập / Đăng ký</div>
            <div className="text-xs text-muted mb-3">
              Lần đầu: điền cả 3 ô rồi bấm "Đăng ký" để tạo tài khoản admin
              đầu tiên. Sau đó bấm "Đăng nhập".
            </div>
            <div className="space-y-2">
              <FormField label="Email">
                <Input value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@cty.com" />
              </FormField>
              <FormField label="Tên (cần khi đăng ký)">
                <Input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Quản trị" />
              </FormField>
              <FormField label="Mật khẩu (≥ 8 ký tự)">
                <Input type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </FormField>
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" disabled={busy} onClick={doLogin}>
                Đăng nhập
              </Button>
              <Button variant="default" disabled={busy} onClick={doRegister}>
                Đăng ký (admin đầu tiên)
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{user.name} · {user.email}</div>
                  <div className="text-xs text-muted">Vai trò: {user.role}</div>
                </div>
                <Button variant="default" disabled={busy} onClick={doLogout}
                  icon={<I.Power size={13} />}>
                  Đăng xuất
                </Button>
              </div>
            </Card>

            <Card className="mb-4">
              <div className="font-semibold mb-2">Entity ({entities.length})</div>
              <div className="flex items-end gap-2 mb-3">
                <div className="flex-1">
                  <FormField label="Tên entity mới">
                    <Input value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createEntity()}
                      placeholder="Khách hàng" />
                  </FormField>
                </div>
                <Button variant="primary" disabled={busy} icon={<I.Plus size={13} />}
                  onClick={createEntity}>
                  Tạo
                </Button>
              </div>
              {entities.length === 0 ? (
                <div className="text-sm text-muted py-2">Chưa có entity nào.</div>
              ) : (
                <div className="divide-y divide-border">
                  {entities.map((en) => (
                    <button key={en.id} type="button"
                      onClick={() => selectEntity(en)}
                      className={
                        "w-full py-2 flex items-center gap-2 text-sm text-left " +
                        (selected?.id === en.id ? "text-accent" : "")
                      }>
                      <I.Database size={14} className="text-muted" />
                      <span className="font-medium">{en.label}</span>
                      <span className="text-xs text-muted font-mono">{en.name}</span>
                      <span className="text-xs text-muted ml-auto">
                        {en.fields.length} field
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {selected && (
              <Card className="mb-4">
                <div className="font-semibold mb-1">
                  Entity: {selected.label}
                  <span className="text-xs text-muted font-mono ml-2">{selected.name}</span>
                </div>

                {/* Thêm field */}
                <div className="text-xs text-muted mt-2 mb-1">Thêm field</div>
                <div className="flex items-end gap-2 mb-3">
                  <div className="flex-1">
                    <Input value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder="Tên field (vd: Tổng tiền)" />
                  </div>
                  <Select value={fieldType} className="w-32"
                    onChange={(e) => setFieldType(e.target.value as "text" | "number")}>
                    <option value="text">text</option>
                    <option value="number">number</option>
                  </Select>
                  <Button variant="default" disabled={busy} icon={<I.Plus size={13} />}
                    onClick={addField}>
                    Thêm
                  </Button>
                </div>

                {/* Tạo record — 1 ô / field */}
                {selected.fields.length === 0 ? (
                  <div className="text-sm text-muted py-2">
                    Thêm ít nhất một field rồi mới tạo được record.
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-muted mb-1">Tạo record mới</div>
                    <div className="space-y-2 mb-2">
                      {selected.fields.map((f) => (
                        <FormField key={f.name} label={`${f.label} (${f.type})`}>
                          <Input value={recordForm[f.name] ?? ""}
                            onChange={(e) =>
                              setRecordForm({ ...recordForm, [f.name]: e.target.value })}
                            placeholder={f.type === "number" ? "vd: 1500000" : ""} />
                        </FormField>
                      ))}
                    </div>
                    <Button variant="primary" disabled={busy} icon={<I.Plus size={13} />}
                      onClick={createRecord}>
                      Tạo record
                    </Button>
                    <div className="text-[11px] text-muted mt-1">
                      Mẹo: nhập chữ vào field "number" để thấy validate-on-write chặn lại.
                    </div>
                  </>
                )}

                {/* Danh sách record */}
                {records.length > 0 && (
                  <div className="mt-4 border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted text-xs uppercase border-b border-border">
                          {selected.fields.map((f) => (
                            <th key={f.name} className="text-left py-1.5 px-2 font-semibold">
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((r) => (
                          <tr key={r.id} className="border-b border-border last:border-0">
                            {selected.fields.map((f) => (
                              <td key={f.name} className="py-1.5 px-2 font-mono text-xs">
                                {String(r.data[f.name] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            <Card>
              <div className="font-semibold mb-1">Cấu hình MCP (trong PostgreSQL)</div>
              <div className="text-xs text-muted mb-2">
                Lưu vào bảng <span className="font-mono">mcp_configs</span>. Sửa JSON rồi bấm Lưu.
              </div>
              <Textarea rows={5} value={mcpJson}
                onChange={(e) => setMcpJson(e.target.value)}
                className="font-mono text-xs" />
              <div className="mt-2">
                <Button variant="primary" disabled={busy} icon={<I.Save size={13} />}
                  onClick={saveMcp}>
                  Lưu cấu hình MCP
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/server-data")({ component: ServerData });
