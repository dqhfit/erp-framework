/* ==========================================================
   DocumentWidget — nhúng OnlyOffice Document Server vào page.
   Nhận sourceId (knowledge_source kind=file) + mode (view/edit).
   Gọi tRPC documents.getSession để lấy JWT-signed config,
   rồi khởi tạo DocsAPI.DocEditor trong div nội tuyến.
   ========================================================== */

import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useId, useRef, useState } from "react";
import { I } from "@/components/Icons";

const api = createApiDataSource("");

interface OoSession {
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: Record<string, boolean>;
  };
  documentType: string;
  editorConfig: Record<string, unknown>;
  token: string;
  sourceId: string;
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor: () => void };
    };
  }
}

interface Props {
  cfg: Record<string, unknown>;
}

export function DocumentWidget({ cfg }: Props) {
  const sourceId = cfg.sourceId as string | undefined;
  const mode = (cfg.mode as "view" | "edit" | undefined) ?? "view";
  const editorId = `oo-editor-${useId().replace(/:/g, "")}`;
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<OoSession | null>(null);

  // Lấy session config từ tRPC khi sourceId/mode thay đổi.
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSession(null);
    api
      .getDocumentSession(sourceId, mode)
      .then((data) => {
        if (!cancelled) setSession(data as OoSession);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, mode]);

  // Khởi tạo / cập nhật editor khi session thay đổi.
  useEffect(() => {
    if (!session) return;

    function mount() {
      if (!window.DocsAPI) return;
      editorRef.current?.destroyEditor();
      editorRef.current = new window.DocsAPI.DocEditor(
        editorId,
        session as unknown as Record<string, unknown>,
      );
    }

    if (window.DocsAPI) {
      mount();
    } else {
      // Chỉ thêm script 1 lần (kiểm tra qua id).
      const existing = document.getElementById("oo-api-script");
      if (existing) {
        // Script đang load — chờ onload.
        existing.addEventListener("load", mount, { once: true });
        return () => existing.removeEventListener("load", mount);
      }
      const script = document.createElement("script");
      script.id = "oo-api-script";
      script.src = "/onlyoffice/web-apps/apps/api/documents/api.js";
      script.onload = mount;
      script.onerror = () =>
        setError("Không tải được OnlyOffice — kiểm tra xem service đã chạy chưa.");
      document.head.appendChild(script);
    }

    return () => {
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
  }, [session, editorId]);

  if (!sourceId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted text-sm p-4">
        <I.FileText className="w-8 h-8 opacity-40" />
        <span>Chưa chọn file — cấu hình sourceId trong designer.</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm gap-2">
        <I.Loader className="w-4 h-4 animate-spin" />
        <span>Đang tải editor…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-sm p-4">
        <I.AlertCircle className="w-6 h-6 text-danger" />
        <span className="text-danger text-center">{error}</span>
        {error.includes("ONLYOFFICE_JWT_SECRET") && (
          <span className="text-muted text-xs text-center max-w-xs">
            Thêm ONLYOFFICE_JWT_SECRET vào .env rồi khởi động lại server.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full" style={{ minHeight: 400 }}>
      <div id={editorId} className="w-full h-full" />
    </div>
  );
}
