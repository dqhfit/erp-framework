import { I } from "@/components/Icons";
import { Button, Card, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useUserObjects } from "@/stores/userObjects";
import { createObjectsClient } from "@erp-framework/client";
/* ==========================================================
   settings.transfer — Xuất/nhập trọn cấu hình low-code:
   entity + page + workflow + agent thành một gói JSON. Dùng để
   chia sẻ "ERP mẫu" hoặc sao lưu/khôi phục cấu hình.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";

const objects = createObjectsClient("");

function TransferSettings() {
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
      setMsg("✓ Đã tải xuống gói cấu hình.");
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
      const ok = await dialog.confirm("Nhập cấu hình sẽ ghi đè các đối tượng trùng id. Tiếp tục?", {
        title: "Nhập cấu hình",
        confirmText: "Nhập",
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
        `✓ Đã nhập: ${counts.entities} entity · ${counts.pages} page · ` +
          `${counts.workflows} workflow · ${counts.agents} agent.`,
      );
    } catch (e) {
      setErr(`Lỗi nhập: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[720px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Xuất / Nhập cấu hình</h1>
        <div className="text-sm text-muted mb-6">
          Đóng gói toàn bộ entity, page, workflow, agent thành một file JSON — để sao lưu hoặc chia
          sẻ "ERP mẫu". (Dữ liệu bản ghi và plugin không nằm trong gói này.)
        </div>

        <Card className="space-y-3 mb-4">
          <div className="font-semibold">Xuất cấu hình</div>
          <div className="text-xs text-muted">
            Tải về một file JSON chứa mọi đối tượng low-code đang có.
          </div>
          <Button variant="primary" icon={<I.Save size={14} />} disabled={busy} onClick={doExport}>
            Tải gói cấu hình
          </Button>
        </Card>

        <Card className="space-y-3">
          <div className="font-semibold">Nhập cấu hình</div>
          <div className="text-xs text-muted">
            Chọn file JSON đã xuất. Đối tượng trùng id sẽ bị ghi đè.
          </div>
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
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Chọn file để nhập
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
