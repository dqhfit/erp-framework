/* ==========================================================
   dialog — Async helpers thay native alert/confirm/prompt.
   Defaults được dịch theo locale hiện tại (qua t()).
   ========================================================== */
import { useDialog } from "@/stores/dialog";
import { t } from "@/hooks/useT";

interface CommonOpts {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

function alertDialog(message: string, opts: CommonOpts = {}): Promise<void> {
  return new Promise((resolve) => {
    useDialog.getState().open({
      kind: "alert",
      title: opts.title ?? t("dialog.alert_title"),
      message,
      confirmText: opts.confirmText ?? t("common.ok"),
      cancelText: "",
      resolve: () => resolve(),
    });
  });
}

function confirmDialog(message: string, opts: CommonOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialog.getState().open({
      kind: "confirm",
      title: opts.title ?? t("dialog.confirm_title"),
      message,
      confirmText: opts.confirmText ?? t("common.ok"),
      cancelText: opts.cancelText ?? t("common.cancel"),
      danger: opts.danger,
      resolve: (r) => resolve(!!r),
    });
  });
}

interface PromptOpts extends CommonOpts {
  placeholder?: string;
}
function promptDialog(message: string, defaultValue = "", opts: PromptOpts = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialog.getState().open({
      kind: "prompt",
      title: opts.title ?? t("dialog.prompt_title"),
      message,
      defaultValue,
      placeholder: opts.placeholder,
      confirmText: opts.confirmText ?? t("common.ok"),
      cancelText: opts.cancelText ?? t("common.cancel"),
      resolve: (r) => resolve(typeof r === "string" ? r : null),
    });
  });
}

export const dialog = {
  alert: alertDialog,
  confirm: confirmDialog,
  prompt: promptDialog,
};
