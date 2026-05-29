/* ==========================================================
   RelationsTab — Tab "Quan hệ" trong settings.migration.
   Hiển thị entity đã migrate + gợi ý FK từ proc joinPairs +
   nút Apply để set field.ref. Bảng đơn giản (không XYflow V1).
   ========================================================== */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";

const migration = createMigrationClient("");

type RelationsData = Awaited<ReturnType<typeof migration.listMigratedRelations>>;
type Hint = RelationsData["hints"][number];

interface Props {
  moduleName: string;
  onChanged: () => void;
}

export function RelationsTab({ moduleName, onChanged }: Props) {
  const [scope, setScope] = useState<"this-module" | "all">("this-module");
  const [data, setData] = useState<RelationsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const reload = () => {
    setLoading(true);
    setErr("");
    migration
      .listMigratedRelations(scope === "this-module" ? { module: moduleName } : {})
      .then(setData)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload bị deps đủ
  useEffect(() => {
    reload();
  }, [moduleName, scope]);

  const applyHint = async (h: Hint) => {
    try {
      await migration.applyRelationHint({
        sourceEntityId: h.sourceEntityId,
        sourceField: h.sourceField,
        targetEntityId: h.targetEntityId,
      });
      toast.success(`${h.sourceEntityName}.${h.sourceField} → ${h.targetEntityName}`);
      reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const unsetRef = async (entityId: string, fieldName: string, entityLabel: string) => {
    const ok = await dialog.confirm(`Xoá liên kết của ${entityLabel}.${fieldName}?`, {
      title: "Xác nhận",
      danger: true,
    });
    if (!ok) return;
    try {
      await migration.applyRelationHint({
        sourceEntityId: entityId,
        sourceField: fieldName,
        targetEntityId: null,
      });
      reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const applyAllPending = async () => {
    if (!data) return;
    const pending = data.hints.filter((h) => !h.applied);
    if (pending.length === 0) {
      toast.info("Không có gợi ý nào chưa apply.");
      return;
    }
    const ok = await dialog.confirm(`Áp dụng tất cả ${pending.length} gợi ý FK chưa apply?`, {
      title: "Apply bulk",
    });
    if (!ok) return;
    let changed = 0;
    let noop = 0;
    let failed = 0;
    for (const h of pending) {
      try {
        const res = await migration.applyRelationHint({
          sourceEntityId: h.sourceEntityId,
          sourceField: h.sourceField,
          targetEntityId: h.targetEntityId,
        });
        if ((res as { changed?: boolean }).changed === false) noop++;
        else changed++;
      } catch {
        failed++;
      }
    }
    toast.success(
      `Apply: ${changed} mới${noop > 0 ? `, ${noop} đã đúng (bỏ qua)` : ""}${
        failed > 0 ? `, ${failed} lỗi` : ""
      }.`,
    );
    reload();
    onChanged();
  };

  const pendingHints = (data?.hints ?? []).filter((h) => !h.applied);
  const appliedHints = (data?.hints ?? []).filter((h) => h.applied);

  return (
    <div className="p-4 space-y-4 overflow-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Quan hệ giữa entity đã migrate</h2>
          <p className="text-xs text-muted mt-0.5">
            Gợi ý FK từ proc joinPairs (trong manifest). Click "Apply" để set field.ref → entity
            đích.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="this-module">Module này</option>
            <option value="all">Tất cả module</option>
          </Select>
          <Button
            size="sm"
            variant="default"
            icon={<I.Loader size={12} />}
            onClick={reload}
            disabled={loading}
          >
            {loading ? "Đang tải…" : "Tải lại"}
          </Button>
        </div>
      </div>

      {err && <div className="card p-3 text-xs text-danger border-danger/40">{err}</div>}

      {/* Tóm tắt */}
      {data && (
        <div className="card p-3 text-xs flex items-center gap-3 flex-wrap">
          <span>
            <strong>{data.entities.length}</strong> entity đã migrate
          </span>
          <span className="text-success">
            <strong>{appliedHints.length}</strong> FK đã apply
          </span>
          <span className="text-warning">
            <strong>{pendingHints.length}</strong> gợi ý chưa apply
          </span>
          {pendingHints.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              icon={<I.Check size={12} />}
              onClick={applyAllPending}
              className="ml-auto"
            >
              Apply tất cả gợi ý
            </Button>
          )}
        </div>
      )}

      {/* Hints chưa apply */}
      {data && pendingHints.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">
            Gợi ý FK chưa apply ({pendingHints.length})
          </div>
          <div className="space-y-1.5">
            {pendingHints.map((h) => (
              <div
                key={`${h.sourceEntityId}-${h.sourceField}-${h.targetEntityId}`}
                className="flex items-center gap-2 p-2 rounded border border-warning/30 bg-warning/5"
              >
                <div className="flex-1 text-xs">
                  <span className="font-mono">
                    {h.sourceEntityName}.{h.sourceField}
                  </span>
                  <I.ArrowRight size={10} className="inline mx-1.5 text-muted" />
                  <span className="font-mono text-accent">
                    {h.targetEntityName}.{h.targetField}
                  </span>
                  <div className="text-[10px] text-muted mt-0.5">
                    từ proc {h.fromProc} (module {h.module})
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<I.Check size={11} />}
                  onClick={() => applyHint(h)}
                >
                  Apply
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entities + FK đã có */}
      {data && data.entities.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-border">
            <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">
              Entity đã migrate ({data.entities.length})
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-bg-soft border-b border-border">
              <tr>
                <th className="px-2 py-1.5 text-left">Entity</th>
                <th className="px-2 py-1.5 text-left">Bảng MSSQL gốc</th>
                <th className="px-2 py-1.5 text-left">FK đã có</th>
              </tr>
            </thead>
            <tbody>
              {data.entities.map((e) => {
                const refs = e.fields.filter((f) => f.ref);
                return (
                  <tr key={e.id} className="border-b border-border/40">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{e.label}</div>
                      <div className="font-mono text-[10px] text-muted">{e.name}</div>
                    </td>
                    <td className="px-2 py-1.5 text-muted text-[11px]">{e.mssqlTable ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {refs.length === 0 ? (
                        <span className="text-muted text-[11px]">—</span>
                      ) : (
                        <div className="space-y-1">
                          {refs.map((f) => {
                            const target = data.entities.find((x) => x.id === f.ref);
                            return (
                              <div key={f.name} className="flex items-center gap-1.5">
                                <Chip variant="accent" className="text-[10px]!">
                                  {f.name} → {target?.name ?? "?"}
                                </Chip>
                                <button
                                  type="button"
                                  onClick={() => unsetRef(e.id, f.name, e.label)}
                                  className="text-muted hover:text-danger text-[10px]"
                                  title="Xoá liên kết"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.entities.length === 0 && (
        <div className="card p-6 text-center text-sm text-muted">
          Chưa có entity nào trong scope này. Migrate bảng trước (tab Generate / Data).
        </div>
      )}
    </div>
  );
}
