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
  preloadedFile?: File | null;
  /** Xoá 1 bản ghi theo recordId (records.deleteRecord). Optional — context
   *  không cung cấp thì step delete-record báo lỗi nhẹ. */
  deleteRecord?: (recordId: string) => Promise<void>;
  /** Tạo 1 bản ghi (records.create) → trả id mới. Optional. */
  createRecord?: (entityId: string, data: Record<string, unknown>) => Promise<string | undefined>;
  /** Cập nhật 1 bản ghi (records.update). Optional — thiếu thì step
   *  update-record báo lỗi nhẹ. */
  updateRecord?: (recordId: string, data: Record<string, unknown>) => Promise<void>;
  /** Thông tin người dùng hiện tại — dùng cho token $currentUser. */
  currentUser?: { name: string; email: string };
  /** Gọi proc Tier D đã port (module-procs) cho nút nghiệp vụ (Duyệt...). */
  invokeModule?: (name: string, args: Record<string, unknown>) => Promise<{ output: unknown }>;
  dialog: {
    confirm: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
    /** Popup thông báo (modal, phải bấm OK) — dùng báo lỗi rõ ràng. */
    alert: (message: string, opts?: { title?: string }) => Promise<void>;
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
  /** Mở form Tạo mới master-detail của list (createForm). Do list widget cấp khi
   *  render embeddedActions → cho nút "Tạo đơn hàng" nằm trong thanh hành động. */
  openCreateForm?: () => void;
  /** Mở form Sửa master-detail của list (editForm) theo record ID. */
  openEditForm?: (id: string, readOnly?: boolean) => void;
  /** Xuất toàn bộ record của entity ra file (xlsx/csv). */
  exportRecords?: (entityId: string, format: "xlsx" | "csv", title?: string) => Promise<void>;
  /** In danh sách record của entity (mở cửa sổ in). */
  printRecords?: (entityId: string, title?: string) => Promise<void>;
}

/** Lỗi có phải do thiếu quyền / chưa đăng nhập không. */
function isPermissionError(msg: string): boolean {
  return /không có quyền|forbidden|unauthorized|permission|cần đăng nhập|đang đồng bộ/i.test(msg);
}
/** Thông điệp lỗi thân thiện cho popup — lỗi quyền nói rõ, kèm chi tiết. */
function friendlyActionError(e: unknown, action: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (isPermissionError(msg)) {
    return `Bạn không có quyền ${action} (hoặc dữ liệu đang khoá ghi).\nLiên hệ quản trị viên để được cấp quyền.\n\nChi tiết: ${msg}`;
  }
  return `Không thể ${action}.\n\nChi tiết: ${msg}`;
}

/* ── Interpolate {{state.key}} → values[key] ───────────────── */
const TPL = /\{\{\s*([a-zA-Z_$][\w$.]*)\s*\}\}/g;
export function interpolate(template: string, getter: (key: string) => unknown): string {
  return template.replace(TPL, (_full, path: string) => {
    const parts = path.split(".");
    let baseKey = parts[0] ?? "";
    let startIdx = 1;
    if (parts[0] === "state" && parts.length >= 2) {
      baseKey = parts[1] ?? "";
      startIdx = 2;
    }
    let val = getter(baseKey);
    for (let i = startIdx; i < parts.length; i++) {
      const key = parts[i];
      if (key && val && typeof val === "object") {
        val = (val as Record<string, unknown>)[key];
      } else {
        val = undefined;
        break;
      }
    }
    return val == null ? "" : String(val);
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
  if (b.source === "state") {
    // Tra trực tiếp theo key; nếu chưa có VÀ key dạng "obj.field" → đi sâu vào
    // object lưu ở state (vd "selProduct.id" lấy id của record popup trả về).
    const direct = getter(b.key);
    if (direct !== undefined || !b.key.includes(".")) return direct;
    const parts = b.key.split(".");
    let cur: unknown = getter(parts[0] ?? b.key);
    for (const part of parts.slice(1)) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
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
  output?: unknown;
}

export async function runActionSteps(
  steps: ActionStep[],
  ctx: ActionContext,
): Promise<RunActionResult> {
  const rs = makeRuntimeState(ctx);
  let procedureRuns = 0;
  let lastResult: unknown;
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
      let value: unknown;
      if (step.value && typeof step.value === "object" && "source" in (step.value as object)) {
        value = resolveBinding(step.value as BindingValue, rs.get);
      } else if (typeof step.value === "string") {
        value = interpolate(step.value, rs.get);
      } else {
        value = step.value;
      }
      rs.set(step.key, value);
      continue;
    }
    if (step.kind === "refresh") {
      // Đặt timestamp MỚI mỗi lần → __refresh đổi giá trị → list refetch.
      const stamp = Date.now();
      for (const eid of step.entities) rs.set(`__refresh:${eid}`, stamp);
      continue;
    }
    if (step.kind === "export-records") {
      if (!ctx.exportRecords) {
        ctx.toast.error("Xuất dữ liệu không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      try {
        await ctx.exportRecords(step.entity, step.format ?? "xlsx", step.title);
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "xuất dữ liệu"), {
          title: "Không xuất được",
        });
        throw e;
      }
      continue;
    }
    if (step.kind === "print-records") {
      if (!ctx.printRecords) {
        ctx.toast.error("In dữ liệu không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      try {
        await ctx.printRecords(step.entity, step.title);
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "in dữ liệu"), { title: "Không in được" });
        throw e;
      }
      continue;
    }
    if (step.kind === "navigate") {
      let href = interpolate(step.href, rs.get);
      if (!href) continue;

      // Tự động viết lại liên kết trang để giữ nguyên chế độ chạy (Designer / Portal / View)
      let openInNewTab = !!step.external;
      const pathname = typeof window !== "undefined" ? window.location.pathname : "";

      if (!step.external) {
        const pageIdMatch = href.match(
          /(?:view\/|page=)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
        );
        if (pageIdMatch) {
          const targetPageId = pageIdMatch[1] ?? "";
          const origin =
            typeof window !== "undefined" ? window.location.origin : "http://localhost";
          const urlObj = new URL(href, origin);
          const params = new URLSearchParams(urlObj.search);
          params.delete("page");

          if (pathname.startsWith("/pages/")) {
            const queryStr = params.toString();
            href = `/pages/${targetPageId}${queryStr ? `?${queryStr}` : ""}`;
            // Trong Designer: sang TRANG KHÁC mới mở tab mới (giữ trạng thái thiết
            // kế của trang đang sửa). Điều hướng NỘI-TRANG — drill-down master-
            // detail cùng trang (chỉ đổi sel/query) — phải ở CÙNG tab; nếu không
            // mỗi lần Xem/Quay lại đẻ 1 tab Chrome mới + tab hiện tại cũng đổi state.
            const curId = (pathname.split("/")[2] ?? "").toLowerCase();
            openInNewTab = targetPageId.toLowerCase() !== curId;
          } else if (pathname.startsWith("/view/")) {
            const queryStr = params.toString();
            href = `/view/${targetPageId}${queryStr ? `?${queryStr}` : ""}`;
          } else {
            params.set("page", targetPageId);
            href = `/portal?${params.toString()}`;
          }
        }
      }

      if (openInNewTab) {
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
      // Popup cần record sẵn (Sửa/Xem có recordIdBinding) mà chưa chọn dòng →
      // báo + dừng, tránh mở form RỖNG gây nhầm là "Thêm".
      if (step.recordIdBinding) {
        const rid = resolveBinding(step.recordIdBinding, rs.get);
        if (rid == null || rid === "") {
          await ctx.dialog.alert("Vui lòng chọn một dòng trong danh sách trước.", {
            title: "Chưa chọn dòng",
          });
          return { completed: false, procedureRuns };
        }
      }
      const result = await ctx.openPopup(step, rs.get);
      if (result === null) return { completed: false, procedureRuns };
      if (step.saveOutputTo) rs.set(step.saveOutputTo, result);
      lastResult = result;
      // Popup persist (tạo/sửa) xong → nạp lại list các entity liên quan.
      if (step.invalidateEntities?.length) {
        const stamp = Date.now();
        for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
      }
      continue;
    }
    if (step.kind === "open-create-form") {
      ctx.openCreateForm?.();
      continue;
    }
    if (step.kind === "open-edit-form") {
      const rid = resolveBinding(step.recordIdBinding, rs.get);
      if (rid == null || rid === "") {
        await ctx.dialog.alert("Vui lòng chọn một dòng trong danh sách trước.", {
          title: "Chưa chọn dòng",
        });
        return { completed: false, procedureRuns };
      }
      ctx.openEditForm?.(String(rid), step.readOnly);
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
      lastResult = result;
      // Wizard lưu (tạo/sửa) xong → nạp lại list các entity liên quan.
      if (step.invalidateEntities?.length) {
        const stamp = Date.now();
        for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
      }
      // ...và refresh các datasource (list join) liên quan.
      if (step.invalidateDataSources?.length) {
        const stamp = Date.now();
        for (const dsId of step.invalidateDataSources) rs.set(`__refresh:ds:${dsId}`, stamp);
      }
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
        await ctx.dialog.alert(friendlyActionError(e, "xoá bản ghi"), { title: "Không xoá được" });
        throw e;
      }
      continue;
    }
    if (step.kind === "create-record") {
      if (!ctx.createRecord) {
        ctx.toast.error("Tạo bản ghi không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const data = resolveBinding(step.dataBinding, rs.get);
      if (data == null || typeof data !== "object") {
        // Người dùng huỷ popup (không có output) → dừng êm, không báo lỗi.
        return { completed: false, procedureRuns };
      }
      try {
        const newId = await ctx.createRecord(step.entity, data as Record<string, unknown>);
        ctx.toast.success("Đã thêm");
        if (step.saveOutputTo && newId) rs.set(step.saveOutputTo, newId);
        lastResult = { id: newId, ...data };
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "thêm bản ghi"), {
          title: "Không thêm được",
        });
        throw e;
      }
      continue;
    }
    if (step.kind === "update-record") {
      if (!ctx.updateRecord) {
        ctx.toast.error("Cập nhật không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const rid = resolveBinding(step.recordIdBinding, rs.get);
      if (rid == null || rid === "") {
        ctx.toast.info("Chưa chọn bản ghi để sửa");
        return { completed: false, procedureRuns };
      }
      const data = resolveBinding(step.dataBinding, rs.get);
      if (data == null || typeof data !== "object") {
        // Người dùng huỷ popup (không có output) → dừng êm, không báo lỗi.
        return { completed: false, procedureRuns };
      }
      try {
        await ctx.updateRecord(String(rid), data as Record<string, unknown>);
        ctx.toast.success("Đã lưu");
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "lưu thay đổi"), { title: "Không lưu được" });
        throw e;
      }
      continue;
    }
    if (step.kind === "update-fields") {
      if (!ctx.updateRecord) {
        ctx.toast.error("Cập nhật không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const rid = resolveBinding(step.recordIdBinding, rs.get);
      if (rid == null || rid === "") {
        await ctx.dialog.alert("Vui lòng chọn một dòng trong danh sách trước.", {
          title: "Chưa chọn dòng",
        });
        return { completed: false, procedureRuns };
      }
      const data: Record<string, unknown> = {};
      for (const [field, val] of Object.entries(step.fields)) {
        if (val === "$currentUser") {
          data[field] = ctx.currentUser?.name ?? ctx.currentUser?.email ?? "";
        } else if (val === "$now") {
          data[field] = new Date().toISOString();
        } else {
          data[field] = resolveBinding(val as BindingValue, rs.get);
        }
      }
      try {
        await ctx.updateRecord(String(rid), data);
        ctx.toast.success("Đã lưu");
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
        if (step.invalidateDataSources?.length) {
          const stamp = Date.now();
          for (const dsId of step.invalidateDataSources) rs.set(`__refresh:ds:${dsId}`, stamp);
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "cập nhật bản ghi"), {
          title: "Không lưu được",
        });
        throw e;
      }
      continue;
    }
    if (step.kind === "update-many-fields") {
      if (!ctx.updateRecord) {
        ctx.toast.error("Cập nhật không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      const idsRaw = resolveBinding(step.recordIdsBinding, rs.get);
      const ids = (Array.isArray(idsRaw) ? idsRaw : [])
        .map((x) => (x == null ? "" : String(x)))
        .filter((x) => x !== "");
      if (ids.length === 0) {
        ctx.toast.info("Chưa chọn bản ghi nào để áp dụng");
        return { completed: false, procedureRuns };
      }
      const data: Record<string, unknown> = {};
      for (const [field, val] of Object.entries(step.fields)) {
        if (val === "$currentUser") {
          data[field] = ctx.currentUser?.name ?? ctx.currentUser?.email ?? "";
        } else if (val === "$now") {
          data[field] = new Date().toISOString();
        } else {
          data[field] = resolveBinding(val as BindingValue, rs.get);
        }
      }
      try {
        let ok = 0;
        for (const id of ids) {
          await ctx.updateRecord(id, data);
          ok++;
        }
        ctx.toast.success(`Đã áp dụng cho ${ok} bản ghi`);
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, "áp dụng cho các bản ghi"), {
          title: "Không lưu được",
        });
        throw e;
      }
      continue;
    }
    if (step.kind === "invoke-module-proc") {
      if (!ctx.invokeModule) {
        ctx.toast.error("Gọi proc nghiệp vụ không khả dụng trong ngữ cảnh này");
        return { completed: false, procedureRuns };
      }
      // Token $currentUser/$now như update-fields — nút nghiệp vụ DQHF (Duyệt
      // LCP) cần nguoiduyet = người đăng nhập + ngayduyet = giờ hiện tại.
      const args: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(step.args)) {
        if (val === "$currentUser") {
          args[k] = ctx.currentUser?.name ?? ctx.currentUser?.email ?? "";
        } else if (val === "$now") {
          args[k] = new Date().toISOString();
        } else {
          const v = resolveBinding(val as BindingValue, rs.get);
          if (v !== undefined) args[k] = v;
        }
      }
      try {
        const r = await ctx.invokeModule(step.procName, args);
        procedureRuns++;
        if (step.saveOutputTo) rs.set(step.saveOutputTo, r.output);
        // Proc trả message → hiện toast thành công có nội dung cụ thể (vd số
        // sản phẩm/dòng đã áp dụng). ActionWidget bỏ toast chung khi có step này.
        const out = r.output as unknown;
        const first = Array.isArray(out) ? out[0] : out;
        const msg =
          first && typeof first === "object" && "message" in first
            ? String((first as { message: unknown }).message)
            : null;
        ctx.toast.success(msg || "Thực hiện thành công");
        if (step.invalidateEntities?.length) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) rs.set(`__refresh:${eid}`, stamp);
        }
        if (step.invalidateDataSources?.length) {
          const stamp = Date.now();
          for (const dsId of step.invalidateDataSources) rs.set(`__refresh:ds:${dsId}`, stamp);
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, `chạy ${step.procName}`), {
          title: "Thao tác thất bại",
        });
        throw e;
      }
      continue;
    }
    if (step.kind === "upload-file") {
      let file: { url: string; name: string } | null = null;
      let f = ctx.preloadedFile;

      if (f) {
        ctx.preloadedFile = null; // consume it
      } else {
        f = await new Promise<File | null>((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          if (step.accept) input.accept = step.accept;
          input.onchange = () => resolve(input.files?.[0] || null);
          input.onerror = () => resolve(null);
          input.oncancel = () => resolve(null);
          input.click();
        });
      }

      if (!f) {
        return { completed: false, procedureRuns };
      }

      const fd = new FormData();
      fd.append("file", f);
      const sub = step.subfolder ? interpolate(step.subfolder, rs.get) : "doc";
      try {
        const res = await fetch(`/upload/file?subfolder=${encodeURIComponent(sub)}`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          ctx.toast.error(body.error || "Lỗi tải file lên");
          return { completed: false, procedureRuns };
        }
        const data = (await res.json()) as { url: string; name: string };
        file = data;
      } catch (err) {
        ctx.toast.error(`Lỗi: ${(err as Error).message}`);
        return { completed: false, procedureRuns };
      }

      if (!file) {
        return { completed: false, procedureRuns };
      }
      if (step.saveUrlTo) rs.set(step.saveUrlTo, file.url);
      if (step.saveNameTo) rs.set(step.saveNameTo, file.name);
      rs.set("uploadedFileSubfolder", step.subfolder ? interpolate(step.subfolder, rs.get) : "doc");
      lastResult = file;
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
        lastResult = result.output;
        if (step.invalidateEntities && step.invalidateEntities.length > 0) {
          const stamp = Date.now();
          for (const eid of step.invalidateEntities) {
            rs.set(`__refresh:${eid}`, stamp);
          }
        }
      } catch (e) {
        await ctx.dialog.alert(friendlyActionError(e, `chạy ${step.procedureName}`), {
          title: "Thao tác thất bại",
        });
        // Throw to signal failure — caller có thể catch để khôi phục UI.
        throw e;
      }
    }
  }
  return { completed: true, procedureRuns, output: lastResult };
}
