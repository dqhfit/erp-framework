/* ==========================================================
   run-action.ts — Thực thi chuỗi ActionStep do người dùng cấu
   hình ở PageDesigner. Chạy tuần tự, lỗi/huỷ → dừng chain.

   Args binding: const | state | template ({{state.key}}).
   Refetch: set pageState["__refresh:<entityId>"] = Date.now()
   để widget useRecords re-fetch (xem ConsumerPage.useRecords).
   ========================================================== */
import type { ProceduresClient } from "@erp-framework/client";
import type {
  ActionStep,
  ActionStepOpenPopup,
  ActionStepOpenWizard,
  BindingValue,
} from "@/types/page";

export interface PageStateLike {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  values: Record<string, unknown>;
}

export interface ActionContext {
  pageState: PageStateLike;
  procClient: ProceduresClient;
  /** Xoá 1 bản ghi theo recordId (records.deleteRecord). Optional — context
   *  không cung cấp thì step delete-record báo lỗi nhẹ. */
  deleteRecord?: (recordId: string) => Promise<void>;
  /** Gọi proc Tier D đã port (module-procs) cho nút nghiệp vụ (Duyệt...). */
  invokeModule?: (name: string, args: Record<string, unknown>) => Promise<{ output: unknown }>;
  dialog: {
    confirm: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
  };
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
  navigate: (href: string) => void;
  openPopup?: (
    step: ActionStepOpenPopup,
    getter: (key: string) => unknown,
  ) => Promise<Record<string, unknown> | null>;
  openWizard?: (
    step: ActionStepOpenWizard,
    getter: (key: string) => unknown,
  ) => Promise<Record<string, unknown> | null>;
}

/* ── Interpolate {{state.key}} → values[key] ───────────────── */
const TPL = /\{\{\s*([a-zA-Z_$][\w$.]*)\s*\}\}/g;
export function interpolate(template: string, getter: (key: string) => unknown): string {
  return template.replace(TPL, (_full, path: string) => {
    const parts = path.split(".");
    if (parts[0] === "state" && parts.length >= 2) {
      const v = getter(parts.slice(1).join("."));
      return v == null ? "" : String(v);
    }
    // Future: {{output.x}}, {{user.x}} ... — V1 chỉ hỗ trợ state.
    return "";
  });
}

/** Wrap pageState với overlay đồng bộ — React setState là async, nên
 *  step sau không thấy giá trị step trước vừa set nếu chỉ đọc qua
 *  pageState.get(). Overlay giữ giá trị mới nhất trong chain. */
function makeRuntimeState(ctx: ActionContext) {
  const overlay: Record<string, unknown> = {};
  const get = (key: string) => (key in overlay ? overlay[key] : ctx.pageState.get(key));
  const set = (key: string, value: unknown) => {
    overlay[key] = value;
    ctx.pageState.set(key, value);
  };
  return { get, set };
}

export function resolveBinding(
  b: BindingValue | undefined,
  getter: (key: string) => unknown,
): unknown {
  if (!b) return undefined;
  if (b.source === "const") return b.value;
  if (b.source === "state") return getter(b.key);
  if (b.source === "template") return interpolate(b.template, getter);
  return undefined;
}

function resolveArgs(
  args: Record<string, BindingValue> | undefined,
  getter: (key: string) => unknown,
): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(args)) {
    const v = resolveBinding(b, getter);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface RunActionResult {
  /** true nếu chạy hết tất cả step; false nếu user huỷ confirm. */
  completed: boolean;
  /** Số step procedure đã chạy thành công. */
  procedureRuns: number;
}

export async function runActionSteps(
  steps: ActionStep[],
  ctx: ActionContext,
): Promise<RunActionResult> {
  const rs = makeRuntimeState(ctx);
  let procedureRuns = 0;
  for (const step of steps) {
    if (step.kind === "confirm") {
      const ok = await ctx.dialog.confirm(step.message, {
        title: step.title,
        danger: step.danger,
      });
      if (!ok) return { completed: false, procedureRuns };
      continue;
    }
    if (step.kind === "set-state") {
      const value = resolveBinding(step.value, rs.get);
      rs.set(step.key, value);
      continue;
    }
    if (step.kind === "navigate") {
      const href = interpolate(step.href, rs.get);
      if (!href) continue;
      if (step.external) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        ctx.navigate(href);
      }
      continue;
    }
    if (step.kind === "open-popup") {
      if (!ctx.openPopup) {
        ctx.toast.error("Popup không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const result = await ctx.openPopup(step, rs.get);
      if (result === null) return { completed: false, procedureRuns };
      if (step.saveOutputTo) rs.set(step.saveOutputTo, result);
      continue;
    }
    if (step.kind === "open-wizard") {
      if (!ctx.openWizard) {
        ctx.toast.error("Wizard không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const result = await ctx.openWizard(step, rs.get);
      if (result === null) return { completed: false, procedureRuns };
      if (step.saveOutputTo) rs.set(step.saveOutputTo, result);
      continue;
    }
    if (step.kind === "delete-record") {
      if (!ctx.deleteRecord) {
        ctx.toast.error("Xoá không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const rid = resolveBinding(step.recordIdBinding, rs.get);
      if (rid == null || rid === "") {
        ctx.toast.info("Chưa chọn bản ghi để xoá");
        return { completed: false, procedureRuns };
      }
      try {
        await ctx.deleteRecord(String(rid));
        ctx.toast.success("Đã xoá");
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
      } catch (e) {
        ctx.toast.error(`Lỗi xoá: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
      continue;
    }
    if (step.kind === "invoke-module-proc") {
      if (!ctx.invokeModule) {
        ctx.toast.error("Gọi proc nghiệp vụ không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const args = resolveArgs(step.args, rs.get);
      try {
        const r = await ctx.invokeModule(step.procName, args);
        procedureRuns++;
        if (step.saveOutputTo) rs.set(step.saveOutputTo, r.output);
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
      } catch (e) {
        ctx.toast.error(`Lỗi ${step.procName}: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
      continue;
    }
    if (step.kind === "procedure") {
      const args = resolveArgs(step.args, rs.get);
      try {
        const result = await ctx.procClient.invoke(step.procedureName, args);
        procedureRuns++;
        if (step.saveOutputTo) {
          rs.set(step.saveOutputTo, result.output);
        }
        if (step.invalidateEntities && step.invalidateEntities.length > 0) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) {
            rs.set(`__refresh:${eid}`, stamp);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.toast.error(`Lỗi gọi ${step.procedureName}: ${msg}`);
        // Throw to signal failure — caller có thể catch để khôi phục UI.
        throw e;
      }
    }
  }
  return { completed: true, procedureRuns };
}
