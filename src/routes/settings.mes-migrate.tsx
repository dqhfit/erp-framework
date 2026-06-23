/* ==========================================================
   settings.mes-migrate — Wizard migrate dữ liệu DQHF (MSSQL)
   → module Mục tiêu sản xuất (PostgreSQL ERP).

   4 bước:
   Step 1 — Kiểm tra kết nối & danh sách dữ liệu sẵn có
   Step 2 — Chọn phạm vi (bộ phận × tháng)
   Step 3 — Preview & xác nhận
   Step 4 — Kết quả + đánh dấu "đã port" trong Cockpit
   ========================================================== */

import {
  createMesMucTieuMigrateClient,
  type MigrateResult,
  type MssqlMonthItem,
  type RelatedForm,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const api = createMesMucTieuMigrateClient("");

/* ── Step indicator ── */
const STEPS = [
  { n: 1, label: "Kiểm tra nguồn" },
  { n: 2, label: "Chọn phạm vi" },
  { n: 3, label: "Xác nhận" },
  { n: 4, label: "Kết quả" },
];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
              ${current === s.n ? "bg-sky-600 text-white" : current > s.n ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}
          >
            {current > s.n ? <I.Check size={12} /> : s.n}
          </div>
          <span
            className={`ml-1.5 text-xs font-medium ${current === s.n ? "text-sky-700" : current > s.n ? "text-emerald-600" : "text-slate-400"}`}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={`mx-3 h-px w-12 ${current > s.n ? "bg-emerald-400" : "bg-slate-200"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Chip bộ phận ── */
function BpChip({
  code,
  selected,
  onClick,
}: {
  code: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
        ${selected ? "border-sky-500 bg-sky-100 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}
    >
      {code}
    </button>
  );
}

/* ── Badge trạng thái port ── */
function PortBadge({ status }: { status: string }) {
  const m: Record<string, { label: string; cls: string }> = {
    chua: { label: "Chưa port", cls: "bg-slate-100 text-slate-500" },
    dang: { label: "Đang port", cls: "bg-amber-100 text-amber-700" },
    xong: { label: "Đã port ✓", cls: "bg-emerald-100 text-emerald-700" },
  };
  const r = m[status] ?? m.chua!;
  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.cls}`}>{r.label}</span>;
}

/* ── Main page ── */
function MesMigratePage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Step 1: dữ liệu MSSQL
  const [available, setAvailable] = useState<MssqlMonthItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Step 2: lựa chọn
  const [selBp, setSelBp] = useState<Set<string>>(new Set());
  const [selYears, setSelYears] = useState<Set<number>>(new Set());

  // Step 3: preview tổng hợp
  const [previews, setPreviews] = useState<
    Array<{ nam: number; thang: number; maBoPhan: string; header: number; chitiet: number }>
  >([]);

  // Step 4: kết quả + forms
  const [results, setResults] = useState<
    Array<{ nam: number; thang: number; maBoPhan: string } & MigrateResult>
  >([]);
  const [forms, setForms] = useState<RelatedForm[]>([]);
  const [markingForm, setMarkingForm] = useState<string | null>(null);

  // ── Step 1 ──────────────────────────────────────────────────────────────
  const loadAvailable = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const data = await api.listAvailable();
      setAvailable(data);
    } catch (e: unknown) {
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAvailable();
  }, [loadAvailable]);

  const bpList = useMemo(
    () => [...new Set((available ?? []).map((r) => r.ma_bo_phan))].sort(),
    [available],
  );
  const yearList = useMemo(
    () => [...new Set((available ?? []).map((r) => r.nam))].sort((a, b) => b - a),
    [available],
  );

  // Tổng số lượt tháng-BP đã chọn
  const selectedItems = useMemo(
    () => (available ?? []).filter((r) => selBp.has(r.ma_bo_phan) && selYears.has(r.nam)),
    [available, selBp, selYears],
  );

  // ── Step 2 → Step 3 ─────────────────────────────────────────────────────
  const buildPreviews = useCallback(async () => {
    if (selectedItems.length === 0) {
      dialog.alert("Chưa chọn bộ phận hoặc năm nào.");
      return;
    }
    setBusy("preview");
    try {
      // selectedItems ĐÃ là đúng tập (nam, thang, ma_bo_phan) cần preview — loop
      // thẳng. Trước đây nhân chéo selectedItems × tất-cả-tháng rồi find(has)
      // lọc lại → O(items×tháng) lượt gọi preview thừa.
      const all: typeof previews = [];
      const errors: string[] = [];
      for (const item of selectedItems) {
        try {
          const p = await api.preview(item.nam, item.thang, item.ma_bo_phan);
          all.push({ nam: item.nam, thang: item.thang, maBoPhan: item.ma_bo_phan, ...p });
        } catch (e) {
          errors.push(`${item.ma_bo_phan} ${item.thang}/${item.nam}: ${(e as Error).message}`);
        }
      }
      // dedupe by (nam, thang, maBoPhan)
      const seen = new Set<string>();
      const deduped = all.filter((r) => {
        const k = `${r.nam}|${r.thang}|${r.maBoPhan}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setPreviews(deduped);
      setStep(3);
      if (errors.length > 0) {
        dialog.alert(
          `Preview ${deduped.length} mục OK, ${errors.length} lỗi:\n${errors
            .slice(0, 5)
            .join("\n")}${errors.length > 5 ? "\n…" : ""}`,
        );
      }
    } finally {
      setBusy(null);
    }
  }, [selectedItems]);

  // ── Step 3 → Step 4: chạy migrate ───────────────────────────────────────
  const runMigrate = useCallback(async () => {
    const confirmed = await dialog.confirm(
      `Migrate ${previews.length} tháng-bộ phận từ MSSQL → PostgreSQL?\n\nThao tác này upsert (an toàn re-run).`,
    );
    if (!confirmed) return;
    setBusy("migrate");
    const done: typeof results = [];
    const errors: string[] = [];
    try {
      // Per-item try/catch: 1 mục lỗi KHÔNG vứt toàn bộ tiến độ đã migrate
      // (upsert an toàn re-run nên giữ phần đã chạy là đúng).
      for (const p of previews) {
        try {
          const r = await api.migrateMonth(p.nam, p.thang, p.maBoPhan);
          done.push({ ...p, ...r });
        } catch (e) {
          errors.push(`${p.maBoPhan} ${p.thang}/${p.nam}: ${(e as Error).message}`);
        }
      }
      setResults(done);
      // Load danh sách form liên quan để đánh dấu port
      const f = await api.listRelatedForms();
      setForms(f);
      setStep(4);
      if (errors.length > 0) {
        dialog.alert(
          `Migrate ${done.length}/${previews.length} OK, ${errors.length} lỗi:\n${errors
            .slice(0, 5)
            .join("\n")}${errors.length > 5 ? "\n…" : ""}`,
        );
      }
    } catch (e: unknown) {
      // Lỗi ngoài vòng (vd listRelatedForms) — vẫn giữ kết quả migrate đã có.
      setResults(done);
      dialog.alert(`Lỗi: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [previews]);

  // ── Step 4: đánh dấu form đã port ───────────────────────────────────────
  const handleMarkPorted = async (sourceCode: string) => {
    setMarkingForm(sourceCode);
    try {
      await api.markPorted(sourceCode);
      setForms((prev) =>
        prev.map((f) => (f.sourceCode === sourceCode ? { ...f, portStatus: "xong" } : f)),
      );
    } catch (e: unknown) {
      dialog.alert(`Lỗi đánh dấu: ${(e as Error).message}`);
    } finally {
      setMarkingForm(null);
    }
  };

  /* ── Render ── */
  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-5">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-800">Migrate — Mục tiêu sản xuất</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Chuyển dữ liệu từ DQHF (MSSQL) sang hệ thống ERP mới (PostgreSQL). Thao tác upsert — an
          toàn chạy lại nhiều lần.
        </p>
      </div>

      <StepBar current={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <I.Database size={16} className="text-sky-500" />
            Kiểm tra nguồn dữ liệu MSSQL
          </h2>

          {/* Hướng dẫn */}
          <div className="rounded bg-sky-50 border border-sky-200 p-3 mb-4 text-sm text-sky-800 space-y-1">
            <p className="font-medium">Yêu cầu trước khi migrate:</p>
            <ol className="list-decimal ml-4 space-y-1 text-xs">
              <li>
                Cấu hình kết nối MSSQL tại{" "}
                <a href="/settings/mssql-connections" className="underline text-sky-600">
                  Settings → Kết nối MSSQL
                </a>{" "}
                với database <code className="bg-sky-100 px-1 rounded">DQHF</code>
              </li>
              <li>
                Bảng nguồn cần có:{" "}
                <code className="bg-sky-100 px-1 rounded">tr_muctieu_sanxuat2</code>,{" "}
                <code className="bg-sky-100 px-1 rounded">tr_muctieu_sanxuat2_chitiet</code>
              </li>
              <li>
                Bảng đích (PostgreSQL) đã được tạo qua migration{" "}
                <code className="bg-sky-100 px-1 rounded">0060_mes_muctieu_sanxuat</code>
              </li>
            </ol>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <I.Loader size={14} className="animate-spin" /> Đang kết nối MSSQL...
            </div>
          )}

          {loadErr && (
            <div className="rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">
              <strong>Lỗi kết nối:</strong> {loadErr}
              <br />
              <span className="text-xs text-red-500">
                Kiểm tra lại cấu hình MSSQL hoặc env MSSQL_CONNECTION_STRING.
              </span>
            </div>
          )}

          {available && !loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                <I.Check size={14} /> Kết nối thành công — <strong>{available.length}</strong> lượt
                tháng-bộ phận có dữ liệu
              </div>
              <div className="text-xs text-slate-500">
                {[...new Set(available.map((r) => r.ma_bo_phan))].length} bộ phận ·{" "}
                {[...new Set(available.map((r) => r.nam))].sort().join(", ")}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={loadAvailable} variant="ghost" disabled={loading}>
              <I.Loader size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Đang tải..." : "Kiểm tra lại"}
            </Button>
            {available && available.length > 0 && (
              <Button onClick={() => setStep(2)} disabled={loading}>
                Tiếp theo <I.ChevronRight size={14} />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && available && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-5">
          <h2 className="font-semibold text-slate-700 flex items-center gap-2">
            <I.Filter size={16} className="text-sky-500" />
            Chọn phạm vi migrate
          </h2>

          {/* Chọn bộ phận */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-600">Bộ phận</p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelBp(new Set(bpList))}
                  className="text-sky-600 hover:underline"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => setSelBp(new Set())}
                  className="text-slate-400 hover:underline"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bpList.map((bp) => (
                <BpChip
                  key={bp}
                  code={bp}
                  selected={selBp.has(bp)}
                  onClick={() =>
                    setSelBp((prev) => {
                      const next = new Set(prev);
                      next.has(bp) ? next.delete(bp) : next.add(bp);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* Chọn năm */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-600">Năm</p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelYears(new Set(yearList))}
                  className="text-sky-600 hover:underline"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => setSelYears(new Set())}
                  className="text-slate-400 hover:underline"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {yearList.map((y) => (
                <BpChip
                  key={y}
                  code={String(y)}
                  selected={selYears.has(y)}
                  onClick={() =>
                    setSelYears((prev) => {
                      const next = new Set(prev);
                      next.has(y) ? next.delete(y) : next.add(y);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* Tổng kết lựa chọn */}
          {selectedItems.length > 0 && (
            <div className="rounded bg-slate-50 border border-slate-200 p-3 text-sm text-slate-600">
              Sẽ migrate <strong>{selectedItems.length}</strong> lượt tháng-bộ phận
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <I.ChevronLeft size={14} /> Quay lại
            </Button>
            <Button
              onClick={buildPreviews}
              disabled={selBp.size === 0 || selYears.size === 0 || busy === "preview"}
            >
              {busy === "preview" ? (
                <I.Loader size={14} className="animate-spin" />
              ) : (
                <I.Search size={14} />
              )}
              Xem trước
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 flex items-center gap-2">
            <I.Eye size={16} className="text-sky-500" />
            Xác nhận migrate
          </h2>

          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Bộ phận</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-600">Tháng</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-600">Năm</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">Header</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((p) => (
                  <tr
                    key={`${p.maBoPhan}-${p.nam}-${p.thang}`}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-3 py-1.5 font-medium text-sky-700">{p.maBoPhan}</td>
                    <td className="px-3 py-1.5 text-center">{p.thang}</td>
                    <td className="px-3 py-1.5 text-center">{p.nam}</td>
                    <td className="px-3 py-1.5 text-right">{p.header} rows</td>
                    <td className="px-3 py-1.5 text-right">{p.chitiet} rows</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2 text-slate-600" colSpan={3}>
                    Tổng {previews.length} lượt
                  </td>
                  <td className="px-3 py-2 text-right">
                    {previews.reduce((s, p) => s + p.header, 0)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {previews.reduce((s, p) => s + p.chitiet, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
            Upsert theo khóa duy nhất <code>(company_id, nam, thang, ma_bo_phan, muc_thuong)</code>{" "}
            và <code>(company_id, ma_cong_doan, ngaythang)</code>. Dữ liệu đã có sẽ được cập nhật.
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={busy === "migrate"}>
              <I.ChevronLeft size={14} /> Quay lại
            </Button>
            <Button onClick={runMigrate} disabled={busy === "migrate"}>
              {busy === "migrate" ? (
                <>
                  <I.Loader size={14} className="animate-spin" /> Đang migrate...
                </>
              ) : (
                <>
                  <I.Download size={14} /> Bắt đầu migrate
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4 ── */}
      {step === 4 && (
        <div className="space-y-4">
          {/* Kết quả */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <I.Check size={18} className="text-emerald-600" />
              <h2 className="font-semibold text-emerald-800">Migrate hoàn tất</h2>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded bg-white border border-emerald-200 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{results.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">Lượt tháng-BP</div>
              </div>
              <div className="rounded bg-white border border-emerald-200 p-3 text-center">
                <div className="text-2xl font-bold text-sky-600">
                  {results.reduce((s, r) => s + r.headersUpserted, 0)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Header upserted</div>
              </div>
              <div className="rounded bg-white border border-emerald-200 p-3 text-center">
                <div className="text-2xl font-bold text-sky-600">
                  {results.reduce((s, r) => s + r.chitietUpserted, 0)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Chi tiết upserted</div>
              </div>
            </div>

            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-emerald-100 border-b border-emerald-200">
                    <th className="px-3 py-1.5 text-left text-emerald-700">BP</th>
                    <th className="px-3 py-1.5 text-center text-emerald-700">T/N</th>
                    <th className="px-3 py-1.5 text-right text-emerald-700">Header</th>
                    <th className="px-3 py-1.5 text-right text-emerald-700">Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={`${r.maBoPhan}-${r.nam}-${r.thang}`}
                      className="border-b border-emerald-100 last:border-0"
                    >
                      <td className="px-3 py-1 font-medium">{r.maBoPhan}</td>
                      <td className="px-3 py-1 text-center">
                        {r.thang}/{r.nam}
                      </td>
                      <td className="px-3 py-1 text-right">{r.headersUpserted}</td>
                      <td className="px-3 py-1 text-right">{r.chitietUpserted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bước tiếp theo */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-semibold text-slate-700 flex items-center gap-2">
              <I.Layers size={16} className="text-sky-500" />
              Bước tiếp theo
            </h2>

            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                  1
                </span>
                <span>
                  Mở{" "}
                  <a href="/mes/muctieu-sanxuat" className="text-sky-600 underline font-medium">
                    Mục tiêu sản xuất
                  </a>{" "}
                  — chọn tháng/bộ phận → nhấn <strong>Tải</strong> để kiểm tra dữ liệu vừa migrate.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                  2
                </span>
                <span>
                  Nhấn <strong>Tính toán</strong> trên từng tháng để chạy lại công thức{" "}
                  <code className="bg-slate-100 px-1 rounded text-xs">mes_muctieu_tinhtoan()</code>{" "}
                  và đảm bảo col1–col25 khớp với nguồn.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                  3
                </span>
                <span>
                  Sau khi kiểm tra xong, đánh dấu các form DQHF bên dưới là "Đã port" để cập nhật
                  bảng đồ tiến độ trong Cockpit.
                </span>
              </div>
            </div>

            {/* Danh sách form liên quan */}
            {forms.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-600 mb-2">
                  Form DQHF liên quan — đánh dấu đã port:
                </p>
                <div className="space-y-2">
                  {forms.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium text-slate-700">{f.name ?? f.sourceCode}</span>
                        {f.winId && <span className="ml-2 text-xs text-slate-400">{f.winId}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <PortBadge status={f.portStatus} />
                        {f.portStatus !== "xong" && (
                          <Button
                            onClick={() => handleMarkPorted(f.sourceCode)}
                            disabled={markingForm === f.sourceCode}
                            variant="ghost"
                          >
                            {markingForm === f.sourceCode ? (
                              <I.Loader size={12} className="animate-spin" />
                            ) : (
                              <I.Check size={12} />
                            )}
                            Đánh dấu xong
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => {
                  setStep(1);
                  setResults([]);
                  setPreviews([]);
                  setSelBp(new Set());
                  setSelYears(new Set());
                  loadAvailable();
                }}
                variant="ghost"
              >
                Migrate thêm
              </Button>
              <a href="/mes/muctieu-sanxuat">
                <Button>
                  Mở trang Mục tiêu sản xuất <I.ChevronRight size={14} />
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/settings/mes-migrate")({
  component: MesMigratePage,
});
