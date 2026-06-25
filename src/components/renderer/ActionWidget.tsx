/* ==========================================================
   ActionWidget — Nút hành động trên page Consumer. onClick chạy
   runActionSteps với context (pageState, procClient, dialog, toast,
   navigate). Tự disable khi user không có quyền run/procedure.
   ========================================================== */
import { createApiDataSource, createProceduresClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { PopupPickerModal } from "@/components/renderer/PopupPickerModal";
import { WizardModal } from "@/components/renderer/WizardModal";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { type Role, roleCan } from "@/lib/permissions";
import { type PageStateLike, resolveBinding, runActionSteps } from "@/lib/run-action";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import type { ActionConfig, ActionStepOpenPopup, ActionStepOpenWizard } from "@/types/page";

const procClient = createProceduresClient("");
const recordsApi = createApiDataSource("");

interface Props {
  config: ActionConfig;
  pageState: PageStateLike;
  /** Chế độ inline: render button trực tiếp không có wrapper h-full.
   *  Dùng bởi ActionBarWidget để xếp nhiều button trong một thanh. */
  inline?: boolean;
  /** Nút nhỏ gọn (size xs) — cho cột hành động theo dòng. */
  compact?: boolean;
  /** Render dạng menu item (không có border/bg riêng) — cho overflow popover. */
  menuItem?: boolean;
  /** Mở form Tạo mới master-detail của list (createForm) — list widget cấp khi
   *  render embeddedActions, cho step "open-create-form". */
  onOpenCreateForm?: () => void;
}

export function ActionWidget({
  config,
  pageState,
  inline = false,
  compact = false,
  menuItem = false,
  onOpenCreateForm,
}: Props) {
  const user = useAuth((s) => s.user);
  const role = user?.role;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [popupStep, setPopupStep] = useState<ActionStepOpenPopup | null>(null);
  const [popupRecordId, setPopupRecordId] = useState<unknown>(undefined);
  // listFilters đã resolve (field → giá trị) cho popup list lọc server-side.
  const [popupFilters, setPopupFilters] = useState<Record<string, unknown> | undefined>(undefined);
  const popupResolveRef = useRef<((v: Record<string, unknown> | null) => void) | null>(null);
  const [wizardStep, setWizardStep] = useState<ActionStepOpenWizard | null>(null);
  const [wizardRecordId, setWizardRecordId] = useState<unknown>(undefined);
  const wizardResolveRef = useRef<((v: Record<string, unknown> | null) => void) | null>(null);

  const hasProcedureStep = useMemo(
    () => (config.steps ?? []).some((s) => s.kind === "procedure"),
    [config.steps],
  );
  const canRun = !hasProcedureStep || (role ? roleCan(role as Role, "run", "procedure") : false);

  const openPopup = useCallback(
    (
      step: ActionStepOpenPopup,
      getter: (key: string) => unknown,
    ): Promise<Record<string, unknown> | null> => {
      const rid = step.recordIdBinding ? resolveBinding(step.recordIdBinding, getter) : undefined;
      setPopupRecordId(rid);
      if (step.listFilters) {
        const f: Record<string, unknown> = {};
        for (const [k, b] of Object.entries(step.listFilters)) {
          const v = resolveBinding(b, getter);
          if (v !== undefined && v !== null && v !== "") f[k] = v;
        }
        setPopupFilters(Object.keys(f).length ? f : undefined);
      } else {
        setPopupFilters(undefined);
      }
      setPopupStep(step);
      return new Promise((resolve) => {
        popupResolveRef.current = resolve;
      });
    },
    [],
  );

  const closePopup = useCallback((value: Record<string, unknown> | null) => {
    setPopupStep(null);
    popupResolveRef.current?.(value);
    popupResolveRef.current = null;
  }, []);

  const openWizard = useCallback(
    (
      step: ActionStepOpenWizard,
      getter: (key: string) => unknown,
    ): Promise<Record<string, unknown> | null> => {
      const rid = step.recordIdBinding ? resolveBinding(step.recordIdBinding, getter) : undefined;
      setWizardRecordId(rid);
      setWizardStep(step);
      return new Promise((resolve) => {
        wizardResolveRef.current = resolve;
      });
    },
    [],
  );

  const closeWizard = useCallback((value: Record<string, unknown> | null) => {
    setWizardStep(null);
    wizardResolveRef.current?.(value);
    wizardResolveRef.current = null;
  }, []);

  const onClick = async () => {
    if (busy || !canRun) return;
    // Hỏi xác nhận top-level (config.requireConfirm) trước khi vào chain.
    if (config.requireConfirm) {
      const ok = await dialog.confirm(config.confirmMessage || "Bạn có chắc chắn?", {
        title: config.confirmTitle || config.label || "Xác nhận",
        danger: config.variant === "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const ctx = {
        pageState,
        procClient,
        currentUser: user ? { name: user.name, email: user.email } : undefined,
        deleteRecord: (recordId: string) => recordsApi.deleteRecord(recordId).then(() => undefined),
        createRecord: (entityId: string, data: Record<string, unknown>) =>
          recordsApi.createRecord(entityId, data).then((r) => r.id),
        updateRecord: (recordId: string, data: Record<string, unknown>) =>
          recordsApi.updateRecord(recordId, data).then(() => undefined),
        invokeModule: (name: string, args: Record<string, unknown>) =>
          procClient.invokeModule(name, args),
        dialog: { confirm: dialog.confirm, alert: dialog.alert },
        toast: { success: toast.success, error: toast.error, info: toast.info },
        navigate: (href: string) => void navigate({ to: href }),
        openPopup,
        openWizard: (s: ActionStepOpenWizard, getter: (key: string) => unknown) =>
          openWizard(s, getter),
        openCreateForm: onOpenCreateForm,
      };
      const res = await runActionSteps(config.steps ?? [], ctx);
      // invoke-module-proc tự hiện toast.success có nội dung (run-action.ts) →
      // bỏ toast chung để tránh hiện 2 thông báo.
      const hasModuleProc = (config.steps ?? []).some((s) => s.kind === "invoke-module-proc");
      if (res.completed && res.procedureRuns > 0 && !hasModuleProc) {
        toast.success(config.label ? `Đã chạy: ${config.label}` : "Đã chạy xong");
      }
    } catch {
      // toast.error đã hiển thị trong run-action.ts; nuốt để không crash widget.
    } finally {
      setBusy(false);
    }
  };

  const variant = config.variant ?? "default";
  const IconComp = config.icon ? I[config.icon] : null;
  const icon = busy ? <I.Loader size={13} /> : IconComp ? <IconComp size={13} /> : null;

  // iconOnly: ẩn label nhưng giữ làm tooltip + aria-label (a11y).
  const title = !canRun
    ? "Bạn không có quyền chạy procedure"
    : config.hint || (config.iconOnly ? config.label : undefined);

  // Menu item style cho overflow popover
  if (menuItem) {
    return (
      <>
        <button
          type="button"
          onClick={onClick}
          disabled={busy || !canRun}
          title={title}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left transition-colors",
            variant === "danger" ? "text-danger hover:bg-danger/10" : "text-text hover:bg-hover",
            (!canRun || busy) && "opacity-50 cursor-not-allowed",
          )}
        >
          {icon}
          <span>{config.label || "Action"}</span>
        </button>
        {popupStep && (
          <PopupPickerModal
            step={popupStep}
            recordId={popupRecordId}
            filters={popupFilters}
            onSelect={(value) => closePopup(value)}
            onCancel={() => closePopup(null)}
          />
        )}
        {wizardStep && (
          <WizardModal
            step={wizardStep}
            recordId={wizardRecordId}
            pageState={pageState}
            onDone={(value) => closeWizard(value)}
            onCancel={() => closeWizard(null)}
            renderAction={(a, key) => (
              <ActionWidget key={key} config={a} pageState={pageState} inline />
            )}
          />
        )}
      </>
    );
  }

  const btn = (
    <Button
      variant={variant}
      size={compact ? "xs" : "md"}
      onClick={onClick}
      disabled={busy || !canRun}
      icon={icon}
      title={title}
      aria-label={config.iconOnly ? config.label : undefined}
      className={inline ? undefined : "w-full"}
    >
      {config.iconOnly ? null : config.label || "Action"}
    </Button>
  );

  return (
    <>
      {inline ? (
        btn
      ) : (
        <div className="h-full w-full flex items-center justify-center p-2">{btn}</div>
      )}
      {popupStep && (
        <PopupPickerModal
          step={popupStep}
          recordId={popupRecordId}
          filters={popupFilters}
          onSelect={(value) => closePopup(value)}
          onCancel={() => closePopup(null)}
        />
      )}
      {wizardStep && (
        <WizardModal
          step={wizardStep}
          recordId={wizardRecordId}
          pageState={pageState}
          onDone={(value) => closeWizard(value)}
          onCancel={() => closeWizard(null)}
          renderAction={(a, key) => (
            <ActionWidget key={key} config={a} pageState={pageState} inline />
          )}
        />
      )}
    </>
  );
}
