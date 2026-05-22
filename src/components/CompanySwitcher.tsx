/* ==========================================================
   CompanySwitcher — Nút chuyển công ty trên Topbar (đa công ty).
   Liệt kê các công ty user là thành viên; chọn công ty khác →
   gọi companies.switch rồi reload để nạp lại toàn bộ dữ liệu
   theo công ty mới.
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createCompaniesClient } from "@erp-framework/client";
import { I } from "@/components/Icons";
import { Chip } from "@/components/ui";
import { useT } from "@/hooks/useT";

const companiesClient = createCompaniesClient("");

interface CompanyItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  isActive: boolean;
}

export function CompanySwitcher() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    companiesClient.list()
      .then((rows) => setItems(rows as CompanyItem[]))
      .catch(() => { /* chưa đăng nhập / chưa có công ty */ });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = items.find((c) => c.isActive);

  const doSwitch = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await companiesClient.switch(id);
      // Đổi công ty → nạp lại toàn bộ dữ liệu phạm vi công ty.
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="hidden md:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm max-w-[180px]"
        title={t("company.active_title")}
      >
        <I.Briefcase size={14} className="text-muted shrink-0" />
        <span className="truncate">{active?.name ?? t("company.fallback")}</span>
        <I.ChevronDown size={12} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-64 panel rounded-lg shadow-2xl border border-border py-1 z-[800]">
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted">
            {t("company.your_companies")}
          </div>
          {items.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted">{t("company.none")}</div>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => (c.isActive ? setOpen(false) : void doSwitch(c.id))}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover/50 text-left disabled:opacity-50"
            >
              <I.Briefcase size={14} className="text-muted shrink-0" />
              <span className="truncate flex-1">{c.name}</span>
              <Chip className="!h-[18px] !text-[10px]">{c.role}</Chip>
              {c.isActive && <I.Check size={14} className="text-success shrink-0" />}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); void navigate({ to: "/settings/companies" }); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover/50 text-left"
            >
              <I.Settings size={14} className="text-muted" />
              {t("company.manage")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
