import { createObjectsClient } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
/* ==========================================================
   settings.transfer — Xuất/nhập trọn cấu hình low-code:
   entity + page + workflow + agent thành một gói JSON. Dùng để
   chia sẻ "ERP mẫu" hoặc sao lưu/khôi phục cấu hình.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";

const objects = createObjectsClient("");

function TransferSettings() {
  const t = useT();
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const doExport = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const bundle = await objects.transfer.export();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `erp-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t("settings.transfer.export_ok"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const ok = await dialog.confirm(t("settings.transfer.import_confirm"), {
        title: t("settings.transfer.import_confirm_title"),
        confirmText: t("settings.transfer.import_confirm_btn"),
      });
      if (!ok) {
        setBusy(false);
        return;
      }
      const counts = await objects.transfer.import({
        entities: bundle.entities,
        pages: bundle.pages,
        workflows: bundle.workflows,
        agents: bundle.agents,
      });
      await useUserObjects.getState().hydrate();
      setMsg(
        t("settings.transfer.import_ok", {
          entities: String(counts.entities),
          pages: String(counts.pages),
          workflows: String(counts.workflows),
          agents: String(counts.agents),
        }),
      );
    } catch (e) {
      setErr(`${t("settings.transfer.import_error")} ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[720px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">{t("settings.transfer.title")}</h1>
        <div className="text-sm text-muted mb-3">{t("settings.transfer.subtitle")}</div>

        <Card className="space-y-3 mb-4">
          <div className="font-semibold">{t("settings.transfer.export_title")}</div>
          <div className="text-xs text-muted">{t("settings.transfer.export_desc")}</div>
          <Button variant="primary" icon={<I.Save size={14} />} disabled={busy} onClick={doExport}>
            {t("settings.transfer.export_btn")}
          </Button>
        </Card>

        <Card className="space-y-3">
          <div className="font-semibold">{t("settings.transfer.import_title")}</div>
          <div className="text-xs text-muted">{t("settings.transfer.import_desc")}</div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
            }}
          />
          <Button
            variant="default"
            icon={<I.Eye size={14} />}
            disabled={busy || !canEdit}
            onClick={() => fileRef.current?.click()}
          >
            {t("settings.transfer.import_btn")}
          </Button>
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

export const Route = createFileRoute("/settings/transfer")({ component: TransferSettings });
