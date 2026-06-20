/* MigratedEntitiesScreen (Phase T) — list entity đã migrate
   (meta.source.kind='migration') + cleanup/regenerate an toàn.
   Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { SidebarSection } from "@/components/migration/SidebarSection";
import { Button, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

function MigratedEntitiesPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof migration.listMigratedEntities>>>([]);
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    migration
      .listMigratedEntities()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalRows = rows.reduce((s, r) => s + r.recordCount, 0);

  const doCleanup = async (
    row: (typeof rows)[number],
    mode: "records-only" | "entity-and-records" | "re-migrate",
  ) => {
    const labels = {
      "records-only": {
        title: "Xoá records",
        body: `Xoá toàn bộ ${row.recordCount} records của entity "${row.name}"? Entity giữ nguyên — có thể re-import sau.`,
      },
      "entity-and-records": {
        title: "Xoá cả entity",
        body: `Xoá entity "${row.name}" + ${row.recordCount} records? Không thể hoàn tác. Manifest cũng được cập nhật (gỡ migratedAt).`,
      },
      "re-migrate": {
        title: "Migrate lại",
        body: `Xoá ${row.recordCount} records cũ và import lại từ MSSQL bảng "${row.mssqlTable ?? "?"}"?`,
      },
    } as const;
    const ok = await dialog.confirm(labels[mode].body, {
      title: labels[mode].title,
      confirmText: labels[mode].title,
    });
    if (!ok) return;
    setBusyRowId(row.id);
    setErr("");
    try {
      await migration.cleanupMigratedEntity({ entityId: row.id, mode });
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRowId(null);
    }
  };

  const doGeneratePage = async (row: (typeof rows)[number]) => {
    setBusyRowId(row.id);
    setErr("");
    try {
      const r = await migration.generateMasterDetailPage({ entityId: row.id });
      const childMsg =
        r.backwardChildren.length > 0
          ? `\n\nChild entity (${r.backwardChildren.length}):\n` +
            r.backwardChildren
              .map(
                (c) =>
                  `• ${c.label ?? c.entityLabel} (qua ${c.fkField})${
                    c.source === "collection" ? " [collection]" : ""
                  }`,
              )
              .join("\n")
          : "\n\nKhông có child entity (chỉ list + detail).";
      const open = await dialog.confirm(
        `${r.upserted === "created" ? "Đã tạo" : "Đã cập nhật"} page "${r.pageLabel}".${childMsg}\n\nMở page ngay?`,
        { title: "Tạo page master-detail", confirmText: "Mở page" },
      );
      if (open) {
        window.open(`/pages/${r.pageId}`, "_blank");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRowId(null);
    }
  };

  const doBulkCleanup = async (mode: "records-only" | "entity-and-records") => {
    const labels = {
      "records-only": {
        title: "Xoá tất cả records migrate",
        body: `Xoá ${totalRows} records của ${rows.length} entity? Entity giữ nguyên.`,
      },
      "entity-and-records": {
        title: "Xoá tất cả entity migrate",
        body: `Xoá ${rows.length} entity + ${totalRows} records? KHÔNG đụng entity hệ thống / user tạo tay.`,
      },
    } as const;
    const ok = await dialog.confirm(labels[mode].body, {
      title: labels[mode].title,
      confirmText: labels[mode].title,
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const r = await migration.cleanupAllMigrated({ mode });
      await dialog.alert(
        `Đã ${labels[mode].title.toLowerCase()}: ${r.succeeded}/${r.total} thành công.`,
        { title: "Kết quả" },
      );
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarSection
      storageKey="migration:section-migrated"
      title={
        <>
          <I.Database size={13} className="inline mr-1" />
          Bảng đã migrate
          {rows.length > 0 && (
            <Chip variant="accent" className="text-[9px]! ml-1">
              {rows.length}
            </Chip>
          )}
        </>
      }
      actions={
        rows.length > 0 ? (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => doBulkCleanup("records-only")}
              title="Xoá tất cả records migrate, giữ entity"
            >
              Xoá records hết
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => doBulkCleanup("entity-and-records")}
              title="Xoá tất cả entity migrate"
            >
              Xoá entity hết
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="text-[10px] text-muted mt-1 mb-2 flex items-center gap-1">
        <I.AlertCircle size={10} /> Chỉ entity do migration tạo. Entity hệ thống / user tạo tay
        KHÔNG hiển thị.
      </div>
      {err && <div className="text-danger text-xs mb-2">{err}</div>}
      {rows.length === 0 ? (
        <div className="text-xs text-muted">Chưa có entity nào do migration tạo.</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="text-xs border border-border rounded p-2 bg-bg">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.label || r.name}</div>
                  <div className="text-muted text-[10px] truncate font-mono">
                    {r.mssqlTable ?? "?"} → {r.name}
                  </div>
                  <div className="text-muted text-[10px] truncate">
                    {r.connectionName ?? "(no conn)"} · {r.module ?? "?"} ·{" "}
                    {r.recordCount.toLocaleString("vi-VN")} rows ·{" "}
                    {r.importedAt ? new Date(r.importedAt).toLocaleString("vi-VN") : "—"}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 mt-1.5">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doCleanup(r, "records-only")}
                  title="Xoá records, giữ entity"
                  icon={<I.Trash size={11} />}
                >
                  Xoá records
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doCleanup(r, "entity-and-records")}
                  title="Xoá entity + records"
                  icon={<I.X size={11} />}
                >
                  Xoá entity
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id || !r.connectionId || !r.mssqlTable}
                  onClick={() => doCleanup(r, "re-migrate")}
                  title="Xoá records và import lại từ MSSQL"
                  icon={<I.Redo size={11} />}
                >
                  Migrate lại
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doGeneratePage(r)}
                  title="Sinh page master-detail từ relation graph"
                  icon={<I.Layout size={11} />}
                >
                  Tạo page
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}

export function MigratedEntitiesScreen({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <I.Database size={15} />
        <span className="font-semibold">Bảng đã migrate</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60"
          title="Đóng"
        >
          <I.X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <MigratedEntitiesPanel onChanged={onChanged} />
      </div>
    </div>
  );
}
