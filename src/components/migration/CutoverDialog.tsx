/* ==========================================================
   CutoverDialog — checklist pre-flight + thực hiện cutover
   module từ mirror sang live, hoặc rollback nếu cần.
   ========================================================== */

import { type CutoverCheck, createMigrationSyncClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Modal } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";

const syncApi = createMigrationSyncClient("");

interface Props {
  moduleName: string;
  connectionId: string;
  /** Đã cutover thành công trước đó — hiện nút rollback thay vì execute. */
  isCutover?: boolean;
  onDone: () => void;
  onClose: () => void;
}

export function CutoverDialog({
  moduleName,
  connectionId,
  isCutover = false,
  onDone,
  onClose,
}: Props) {
  const t = useT();
  const [checks, setChecks] = useState<CutoverCheck[]>([]);
  const [allPass, setAllPass] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");

  const loadChecklist = useCallback(() => {
    setLoading(true);
    syncApi
      .cutoverChecklist(connectionId, moduleName)
      .then(({ checks: c, allPass: ap }) => {
        setChecks(c);
        setAllPass(ap);
      })
      .catch((e: Error) => {
        dialog.alert(e.message);
      })
      .finally(() => setLoading(false));
  }, [connectionId, moduleName]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load khi props đổi
  useEffect(() => {
    loadChecklist();
  }, [connectionId, moduleName]);

  const handleExecute = async () => {
    if (!confirmed) return;
    const ok = await dialog.confirm(t("sync.cutover_confirm_prompt", { module: moduleName }));
    if (!ok) return;
    setBusy(true);
    try {
      const r = await syncApi.executeCutover(connectionId, moduleName);
      setDone(true);
      setDoneMsg(t("sync.cutover_done", { count: r.flippedTables }));
      onDone();
    } catch (e) {
      dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    const ok = await dialog.confirm(t("sync.rollback_confirm_prompt", { module: moduleName }));
    if (!ok) return;
    setBusy(true);
    try {
      const r = await syncApi.rollbackCutover(connectionId, moduleName);
      setDone(true);
      setDoneMsg(t("sync.rollback_done", { count: r.restoredTables }));
      onDone();
    } catch (e) {
      dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const footer = done ? (
    <Button onClick={onClose}>{t("common.close")}</Button>
  ) : isCutover ? (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {t("common.cancel")}
      </Button>
      <Button variant="danger" onClick={handleRollback} disabled={busy}>
        {t("sync.btn_rollback")}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {t("common.cancel")}
      </Button>
      <Button
        variant="ghost"
        onClick={loadChecklist}
        disabled={busy || loading}
        icon={<I.RefreshCw size={13} />}
      >
        {t("sync.btn_recheck")}
      </Button>
      <Button variant="primary" onClick={handleExecute} disabled={busy || !allPass || !confirmed}>
        {t("sync.btn_execute_cutover")}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={t(isCutover ? "sync.rollback_title" : "sync.cutover_title", { module: moduleName })}
      width={520}
      footer={footer}
    >
      {done ? (
        <div className="flex items-center gap-2 text-success">
          <I.CheckCircle size={20} />
          <span>{doneMsg}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted">{t("common.loading")}</p>
          ) : (
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  {c.pass ? (
                    <I.CheckCircle size={16} className="text-success shrink-0 mt-0.5" />
                  ) : (
                    <I.XCircle size={16} className="text-danger shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className={c.pass ? "text-text" : "text-danger"}>{c.label}</span>
                    {c.detail && <p className="text-xs text-muted mt-0.5">{c.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!isCutover && (
            <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t("sync.cutover_dqhf_frozen_confirm")}</span>
            </label>
          )}

          {!allPass && !loading && !isCutover && (
            <Chip variant="warning">{t("sync.checklist_fail_hint")}</Chip>
          )}
        </div>
      )}
    </Modal>
  );
}
