/* ==========================================================
   ActionWidget — Nút hành động trên page Consumer. onClick chạy
   runActionSteps với context (pageState, procClient, dialog, toast,
   navigate). Tự disable khi user không có quyền run/procedure.
   ========================================================== */
import { createApiDataSource, createProceduresClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { exportCsvContentAsXlsx } from "@/components/renderer/consumer-utils";
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

/** Parse CSV (RFC-4180 gọn: hỗ trợ ngoặc kép + dấu phẩy/xuống dòng trong ô).
 *  Dùng cho In: nội dung lấy từ records.export (csv) → bảng HTML. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

const htmlEsc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

/** Mở cửa sổ in với bảng HTML dựng từ nội dung CSV. */
function printCsvTable(csv: string, title: string): void {
  const rows = parseCsv(csv);
  if (rows.length === 0) {
    toast.info("Không có dữ liệu để in");
    return;
  }
  const [head, ...body] = rows;
  const thead = `<tr>${(head ?? []).map((h) => `<th>${htmlEsc(h)}</th>`).join("")}</tr>`;
  const tbody = body
    .map((r) => `<tr>${r.map((c) => `<td>${htmlEsc(c)}</td>`).join("")}</tr>`)
    .join("");
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) {
    toast.error("Trình duyệt chặn cửa sổ in");
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;font-size:12px;color:#111;padding:16px}` +
      `h3{margin:0 0 10px}table{border-collapse:collapse;width:100%}` +
      `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;white-space:nowrap}` +
      `th{background:#f3f4f6}</style></head><body>` +
      `<h3>${htmlEsc(title)}</h3><table><thead>${thead}</thead><tbody>${tbody}</tbody></table>` +
      `<script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
}

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
  /** Mở form Sửa master-detail của list (editForm) — cho step "open-edit-form". */
  onOpenEditForm?: (id: string, readOnly?: boolean) => void;
  /** Gọi sau khi chuỗi action chạy xong, dùng để refresh lookup trong wizard cha. */
  onComplete?: (output?: any) => void;
}

export function ActionWidget({
  config,
  pageState,
  inline = false,
  compact = false,
  menuItem = false,
  onOpenCreateForm,
  onOpenEditForm,
  onComplete,
}: Props) {
  const user = useAuth((s) => s.user);
  const role = user?.role;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [popupStep, setPopupStep] = useState<ActionStepOpenPopup | null>(null);
  const [popupRecordId, setPopupRecordId] = useState<unknown>(undefined);
  // listFilters đã resolve (field → giá trị) cho popup list lọc server-side.
  const [popupFilters, setPopupFilters] = useState<Record<string, unknown> | undefined>(undefined);
  const [popupLinkedData, setPopupLinkedData] = useState<Record<string, unknown> | undefined>(
    undefined,
  );
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
      const linkedItems = step.linkedToState
        ? Array.isArray(step.linkedToState)
          ? step.linkedToState
          : [step.linkedToState]
        : [];
      if (linkedItems.length > 0) {
        const linkedData: Record<string, unknown> = {};
        for (const linked of linkedItems) {
          const val = getter(linked.stateKey);
          if (val !== undefined && val !== null && val !== "") linkedData[linked.field] = val;
        }
        setPopupLinkedData(Object.keys(linkedData).length ? linkedData : undefined);
      } else {
        setPopupLinkedData(undefined);
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

    let preloadedFile: File | null = null;
    const hasUploadStep = (config.steps ?? []).some((s) => s.kind === "upload-file");
    if (hasUploadStep) {
      const uploadStep = (config.steps ?? []).find((s) => s.kind === "upload-file");
      const filePromise = new Promise<File | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (uploadStep?.accept) input.accept = uploadStep.accept;
        input.onchange = () => resolve(input.files?.[0] || null);
        input.onerror = () => resolve(null);
        input.oncancel = () => resolve(null);
        input.click();
      });
      preloadedFile = await filePromise;
      if (!preloadedFile) return; // Cancelled or closed
    }

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
        preloadedFile,
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
        navigate: (href: string) => {
          try {
            if (href.includes("?")) {
              const [path, query] = href.split("?");
              const searchParams: Record<string, string> = {};
              const params = new URLSearchParams(query);
              params.forEach((v, k) => {
                searchParams[k] = v;
              });
              void navigate({ to: path, search: searchParams as any });
            } else {
              void navigate({ to: href });
            }
          } catch {
            void navigate({ to: href });
          }
        },
        openPopup,
        openWizard: (s: ActionStepOpenWizard, getter: (key: string) => unknown) =>
          openWizard(s, getter),
        openCreateForm: onOpenCreateForm,
        openEditForm: onOpenEditForm,
        exportRecords: async (entityId: string, format: "xlsx" | "csv", title?: string) => {
          const r = await recordsApi.exportRecords(entityId, "csv");
          const name = title || "export";
          if (format === "xlsx") {
            await exportCsvContentAsXlsx(r.content, name);
          } else {
            const blob = new Blob([`﻿${r.content}`], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${name}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }
          toast.success("Đã xuất dữ liệu");
        },
        printRecords: async (entityId: string, title?: string) => {
          const r = await recordsApi.exportRecords(entityId, "csv");
          printCsvTable(r.content, title || "Danh sách");
        },
      };
      const res = await runActionSteps(config.steps ?? [], ctx);
      // invoke-module-proc tự hiện toast.success có nội dung (run-action.ts) →
      // bỏ toast chung để tránh hiện 2 thông báo.
      const hasModuleProc = (config.steps ?? []).some((s) => s.kind === "invoke-module-proc");
      if (res.completed && res.procedureRuns > 0 && !hasModuleProc) {
        toast.success(config.label ? `Đã chạy: ${config.label}` : "Đã chạy xong");
      }
      if (res.completed) onComplete?.(res.output);
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
            recordId={popupRecordId as string}
            filters={popupFilters as Record<string, string>}
            linkedData={popupLinkedData}
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
            renderAction={(a, key, onActionComplete, customPageState) => (
              <ActionWidget
                key={key}
                config={a}
                pageState={customPageState || pageState}
                inline
                onComplete={onActionComplete}
              />
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
          recordId={popupRecordId as string}
          filters={popupFilters as Record<string, string>}
          linkedData={popupLinkedData}
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
          renderAction={(a, key, onActionComplete, customPageState) => (
            <ActionWidget
              key={key}
              config={a}
              pageState={customPageState || pageState}
              inline
              onComplete={onActionComplete}
            />
          )}
        />
      )}
    </>
  );
}
