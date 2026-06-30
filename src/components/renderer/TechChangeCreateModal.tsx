import { createApiDataSource } from "@erp-framework/client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal } from "@/components/ui";
import { normalizeVi } from "@/lib/text-utils";
import { toast } from "@/lib/toast";
import { useAuth } from "@/stores/auth";
import type { ActionStepOpenTechChangeForm } from "@/types/page";

const api = createApiDataSource("");

type DinhMucCode = keyof ActionStepOpenTechChangeForm["dinhmucEntities"];

const DINH_MUC_OPTIONS: Array<{ code: DinhMucCode; label: string }> = [
  { code: "GVA", label: "Gỗ ván" },
  { code: "NKI", label: "Ngũ kim" },
  { code: "DGO", label: "Đóng gói" },
  { code: "SON", label: "Sơn" },
];

type ProductRow = {
  id: string;
  masp: string;
  tensp: string;
  hehang: string;
};

type DetailRow = {
  key: string;
  productCode: string;
  code: string;
  name: string;
  spec: string;
  color: string;
  qty: string;
  raw: Record<string, unknown>;
};

interface Props {
  step: ActionStepOpenTechChangeForm;
  onDone: (value: Record<string, unknown> | null) => void;
  onCancel: () => void;
}

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function techNumberPrefix(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `TDKT_${yyyy}${mm}${dd}`;
}

function splitList(value: unknown): string[] {
  return str(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function detailShape(
  kind: DinhMucCode,
  productCode: string,
  data: Record<string, unknown>,
): DetailRow {
  if (kind === "GVA") {
    const spec = [data.dayy_tc, data.rong_tc, data.dai_tc].map(str).filter(Boolean).join("*");
    return {
      key: `${productCode}|${str(data.mact)}`,
      productCode,
      code: str(data.mact),
      name: str(data.chitiet),
      spec,
      color: str(data.nguyenlieu),
      qty: str(data.soluong_tc),
      raw: data,
    };
  }
  if (kind === "NKI") {
    return {
      key: `${productCode}|${str(data.mavt)}`,
      productCode,
      code: str(data.mavt),
      name: str(data.chitiet),
      spec: str(data.quycach),
      color: str(data.nhom),
      qty: str(data.soluong || data.slchet || data.slroi),
      raw: data,
    };
  }
  if (kind === "DGO") {
    return {
      key: `${productCode}|${str(data.madonggoi)}`,
      productCode,
      code: str(data.madonggoi),
      name: str(data.chitiet),
      spec: str(data.quycach),
      color: str(data.nhom),
      qty: str(data.soluong),
      raw: data,
    };
  }
  return {
    key: `${productCode}|${str(data.mact)}`,
    productCode,
    code: str(data.mact),
    name: str(data.tenct),
    spec: str(data.buoc),
    color: str(data.mamau),
    qty: str(data.sl_sp || data.sl_m2),
    raw: data,
  };
}

export function TechChangeCreateModal({ step, onDone, onCancel }: Props) {
  const user = useAuth((s) => s.user);
  const recordId = step.recordId;
  const readOnly = step.readOnly === true;
  const isEdit = !!recordId && !readOnly;
  const [sophieu, setSophieu] = useState("");
  const [department, setDepartment] = useState(user?.department?.trim() ?? "");
  const [dinhmuc, setDinhmuc] = useState<DinhMucCode | "">("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [duration, setDuration] = useState<"lau_dai" | "tam_thoi">("lau_dai");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  useEffect(() => {
    if (recordId) return;
    let alive = true;
    const prefix = techNumberPrefix();
    api
      .getRecords(step.entity, { limit: 5000 })
      .then((res) => {
        if (!alive) return;
        const maxSeq = res.rows.reduce((max, row) => {
          const value = str((row.data as Record<string, unknown>).sophieu);
          if (!value.startsWith(prefix)) return max;
          const n = Number(value.slice(prefix.length));
          return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);
        setSophieu(`${prefix}${String(maxSeq + 1).padStart(2, "0")}`);
      })
      .catch(() => {
        if (alive) setSophieu(`${prefix}01`);
      });
    return () => {
      alive = false;
    };
  }, [recordId, step.entity]);

  useEffect(() => {
    if (!recordId) return;
    let alive = true;
    api
      .getRecord(recordId)
      .then((record) => {
        if (!alive || !record) return;
        const data = record.data as Record<string, unknown>;
        const productCodes = splitList(data.masp);
        const productNames = splitList(data.tensp);
        const productGroups = splitList(data.hehang);
        const loadedProducts = productCodes.map((masp, index) => ({
          id: `${recordId}:product:${masp}`,
          masp,
          tensp: productNames[index] ?? "",
          hehang: productGroups[index] ?? productGroups[0] ?? "",
        }));
        const detailCodes = splitList(data.mact);
        const detailNames = splitList(data.tenct);
        const firstProduct = loadedProducts[0]?.masp ?? "";
        setSophieu(str(data.sophieu));
        setDepartment(str(data.bophan));
        setDinhmuc(str(data.dinhmuc) as DinhMucCode | "");
        setProducts(loadedProducts);
        setDetails(
          detailCodes.map((code, index) => ({
            key: `${firstProduct}|${code}`,
            productCode: firstProduct,
            code,
            name: detailNames[index] ?? "",
            spec: "",
            color: "",
            qty: "",
            raw: {},
          })),
        );
        setDuration(str(data.denghithaydoi) === "Tạm thời" ? "tam_thoi" : "lau_dai");
        setContent(str(data.noidungcanthaydoi));
        setReason(str(data.lydothaydoi));
        setDueDate(str(data.ngaycanhoanthanh).slice(0, 10) || todayInput());
      })
      .catch((e) => {
        toast.error((e as Error).message || "Không tải được phiếu thay đổi kỹ thuật");
      });
    return () => {
      alive = false;
    };
  }, [recordId]);

  const productCodes = useMemo(() => products.map((p) => p.masp), [products]);

  const save = async () => {
    if (readOnly) return;
    if (!dinhmuc) {
      toast.error("Vui lòng chọn định mức");
      return;
    }
    if (products.length === 0) {
      toast.error("Vui lòng chọn sản phẩm");
      return;
    }
    if (!dueDate) {
      toast.error("Vui lòng nhập ngày cần hoàn thành");
      return;
    }
    setSaving(true);
    try {
      const detailCodes = [...new Set(details.map((d) => d.code).filter(Boolean))];
      const detailNames = [...new Set(details.map((d) => d.name).filter(Boolean))];
      const data = {
        ...(recordId ? {} : { id: crypto.randomUUID().toUpperCase() }),
        sophieu,
        bophan: department,
        nguoitao: user?.name ?? user?.email ?? "",
        ngaytao: new Date().toISOString(),
        dinhmuc,
        masp: productCodes.join(", "),
        tensp: products
          .map((p) => p.tensp)
          .filter(Boolean)
          .join(", "),
        hehang: [...new Set(products.map((p) => p.hehang).filter(Boolean))].join(", "),
        mact: detailCodes.join(", "),
        tenct: detailNames.join(", "),
        denghithaydoi: duration === "lau_dai" ? "Lâu dài" : "Tạm thời",
        noidungcanthaydoi: content,
        lydothaydoi: reason,
        ngaycanhoanthanh: dueDate,
        active: true,
      };
      const saved = recordId
        ? await api.updateRecord(recordId, data)
        : await api.createRecord(step.entity, data);
      toast.success(
        recordId ? "Đã cập nhật phiếu thay đổi kỹ thuật" : "Đã thêm phiếu thay đổi kỹ thuật",
      );
      onDone({ ...data, recordId: saved.id });
    } catch (e) {
      toast.error((e as Error).message || "Không lưu được phiếu thay đổi kỹ thuật");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onCancel}
        title={
          readOnly
            ? "Xem phiếu thay đổi kỹ thuật"
            : isEdit
              ? "Sửa phiếu thay đổi kỹ thuật"
              : "Thêm phiếu thay đổi kỹ thuật"
        }
        width={940}
        align="top"
        footer={
          <>
            <Button variant="ghost" onClick={onCancel} icon={<I.X size={14} />}>
              Đóng
            </Button>
            {!readOnly && (
              <Button
                variant="primary"
                onClick={save}
                disabled={saving}
                icon={<I.Save size={14} />}
              >
                Lưu
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-[180px_1fr_160px_1fr] items-center gap-2">
            <label className="text-sm text-muted">Số phiếu</label>
            <Input value={sophieu} readOnly />
            <label className="text-sm text-muted">Người đề xuất</label>
            <Input value={user?.name ?? ""} readOnly />
            <label className="text-sm text-muted">Bộ phận</label>
            <Input value={department} readOnly />
            <div />
            <div />
            <label className="text-sm text-muted">
              Định mức <span className="text-danger">(*)</span>
            </label>
            <select
              className="input"
              value={dinhmuc}
              disabled={readOnly}
              onChange={(event) => {
                setDinhmuc(event.target.value as DinhMucCode | "");
                setProducts([]);
                setDetails([]);
              }}
            >
              <option value="">Chọn định mức</option>
              {DINH_MUC_OPTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <div />
            <div />
            <label className="text-sm text-muted">
              Sản phẩm <span className="text-danger">(*)</span>
            </label>
            <div className="col-span-3 space-y-2">
              <button
                type="button"
                className="input text-left flex items-center justify-between gap-2"
                disabled={!dinhmuc}
                onClick={() => {
                  if (products.length > 0) setProductsExpanded((value) => !value);
                }}
              >
                <span className={products.length ? "truncate" : "text-muted"}>
                  {products.length
                    ? `${products.length} sản phẩm đã chọn`
                    : dinhmuc
                      ? "Chọn sản phẩm"
                      : "Chọn định mức trước"}
                </span>
                <span className="flex items-center gap-2">
                  {products.length > 0 &&
                    (productsExpanded ? <I.ChevronUp size={14} /> : <I.ChevronDown size={14} />)}
                  {!readOnly && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-hover"
                      onClick={(event) => {
                        event.stopPropagation();
                        setProductOpen(true);
                      }}
                    >
                      <I.MoreHorizontal size={14} />
                    </button>
                  )}
                </span>
              </button>
              {productsExpanded && <SelectedProductsList products={products} />}
            </div>
            <label className="text-sm text-muted">Chi tiết cần thay đổi</label>
            <div className="col-span-3 space-y-2">
              <button
                type="button"
                className="input text-left flex items-center justify-between gap-2"
                disabled={!dinhmuc || products.length === 0}
                onClick={() => {
                  if (details.length > 0) setDetailsExpanded((value) => !value);
                }}
              >
                <span className={details.length ? "truncate" : "text-muted"}>
                  {details.length
                    ? `${details.length} chi tiết đã chọn`
                    : products.length
                      ? "Chọn chi tiết"
                      : "Chọn sản phẩm trước"}
                </span>
                <span className="flex items-center gap-2">
                  {details.length > 0 &&
                    (detailsExpanded ? <I.ChevronUp size={14} /> : <I.ChevronDown size={14} />)}
                  {!readOnly && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-hover"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailOpen(true);
                      }}
                    >
                      <I.MoreHorizontal size={14} />
                    </button>
                  )}
                </span>
              </button>
              {detailsExpanded && <SelectedDetailsList details={details} />}
            </div>
            <label className="text-sm text-muted">
              Thời gian thay đổi <span className="text-danger">(*)</span>
            </label>
            <div className="col-span-3 flex items-center gap-10 rounded-md border border-border px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={duration === "lau_dai"}
                  disabled={readOnly}
                  onChange={() => setDuration("lau_dai")}
                />
                Lâu dài
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={duration === "tam_thoi"}
                  disabled={readOnly}
                  onChange={() => setDuration("tam_thoi")}
                />
                Tạm thời
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted">Nội dung thay đổi</label>
            <textarea
              className="input min-h-28 w-full resize-y"
              value={content}
              readOnly={readOnly}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Lý do thay đổi</label>
            <textarea
              className="input min-h-24 w-full resize-y"
              value={reason}
              readOnly={readOnly}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-[180px_1fr] items-center gap-2">
            <label className="text-sm text-muted">
              Ngày cần hoàn thành <span className="text-danger">(*)</span>
            </label>
            <Input
              type="date"
              value={dueDate}
              readOnly={readOnly}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>
      </Modal>
      {productOpen && (
        <ProductPicker
          entity={step.productsEntity}
          selected={products}
          onClose={() => setProductOpen(false)}
          onApply={(next) => {
            setProducts(next);
            setDetails((current) =>
              current.filter((d) => next.some((p) => p.masp === d.productCode)),
            );
            setProductOpen(false);
          }}
        />
      )}
      {detailOpen && dinhmuc && (
        <DetailPicker
          dinhmuc={dinhmuc}
          entity={step.dinhmucEntities[dinhmuc]}
          products={products}
          selected={details}
          onClose={() => setDetailOpen(false)}
          onApply={(next) => {
            setDetails(next);
            setDetailOpen(false);
          }}
        />
      )}
    </>
  );
}

function SelectedProductsList({ products }: { products: ProductRow[] }) {
  if (products.length === 0) return null;
  return (
    <div className="max-h-28 overflow-auto rounded-md border border-border bg-bg-soft px-3 py-2 text-xs">
      {products.map((product, index) => (
        <div key={product.id || product.masp} className="flex gap-2 py-0.5">
          <span className="w-5 shrink-0 text-muted tabular-nums">{index + 1}.</span>
          <span className="shrink-0 font-mono">{product.masp}</span>
          <span className="min-w-0 truncate">{product.tensp}</span>
          {product.hehang && <span className="shrink-0 text-muted">({product.hehang})</span>}
        </div>
      ))}
    </div>
  );
}

function SelectedDetailsList({ details }: { details: DetailRow[] }) {
  if (details.length === 0) return null;
  return (
    <div className="max-h-32 overflow-auto rounded-md border border-border bg-bg-soft px-3 py-2 text-xs">
      {details.map((detail, index) => (
        <div key={detail.key} className="flex gap-2 py-0.5">
          <span className="w-5 shrink-0 text-muted tabular-nums">{index + 1}.</span>
          {detail.productCode && <span className="shrink-0 font-mono">{detail.productCode}</span>}
          <span className="shrink-0 font-mono">{detail.code}</span>
          <span className="min-w-0 truncate">{detail.name}</span>
          {detail.spec && <span className="shrink-0 text-muted">QC: {detail.spec}</span>}
          {detail.color && <span className="shrink-0 text-muted">Màu: {detail.color}</span>}
          {detail.qty && <span className="shrink-0 text-muted">SL: {detail.qty}</span>}
        </div>
      ))}
    </div>
  );
}

function ProductPicker({
  entity,
  selected,
  onApply,
  onClose,
}: {
  entity: string;
  selected: ProductRow[];
  onApply: (rows: ProductRow[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [draft, setDraft] = useState<ProductRow[]>(selected);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const handle = setTimeout(() => {
      setLoading(true);
      api
        .getRecords(entity, { limit: 300, q: query.trim() || undefined })
        .then((res) => {
          if (!alive) return;
          setRows(
            res.rows.map((row) => {
              const data = row.data as Record<string, unknown>;
              return {
                id: row.id,
                masp: str(data.masp),
                tensp: str(data.tensp),
                hehang: str(data.hehang),
              };
            }),
          );
        })
        .catch(() => {
          if (alive) setRows([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [entity, query]);

  const toggle = (row: ProductRow) => {
    setDraft((current) =>
      current.some((item) => item.masp === row.masp)
        ? current.filter((item) => item.masp !== row.masp)
        : [...current, row],
    );
  };

  const selectedSet = new Set(draft.map((row) => row.masp));

  return (
    <Modal
      open
      onClose={onClose}
      title="Chọn sản phẩm"
      width={900}
      align="top"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft([])}>
            Bỏ chọn tất cả
          </Button>
          <Button variant="ghost" onClick={onClose} icon={<I.X size={14} />}>
            Đóng
          </Button>
          <Button variant="primary" onClick={() => onApply(draft)} icon={<I.Check size={14} />}>
            Đồng ý
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <I.Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: 34 }}
            placeholder="Nhập mã hoặc tên sản phẩm..."
            autoFocus
          />
        </div>
        <div className="max-h-[560px] overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel-2 text-muted">
              <tr>
                <th className="w-16 px-2 py-2 text-left">Chọn</th>
                <th className="px-2 py-2 text-left">Hệ hàng</th>
                <th className="px-2 py-2 text-left">Mã sản phẩm</th>
                <th className="px-2 py-2 text-left">Tên sản phẩm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-hover">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(row.masp)}
                      onChange={() => toggle(row)}
                    />
                  </td>
                  <td className="px-2 py-1.5">{row.hehang}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{row.masp}</td>
                  <td className="px-2 py-1.5">{row.tensp}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="p-3 text-xs text-muted">Đang tải...</div>}
          {!loading && rows.length === 0 && (
            <div className="p-6 text-center text-sm text-muted">Không có dữ liệu</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function DetailPicker({
  dinhmuc,
  entity,
  products,
  selected,
  onApply,
  onClose,
}: {
  dinhmuc: DinhMucCode;
  entity: string;
  products: ProductRow[];
  selected: DetailRow[];
  onApply: (rows: DetailRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [draft, setDraft] = useState<DetailRow[]>(selected);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      products.map((product) =>
        api
          .getRecords(entity, {
            limit: 1000,
            filters: { masp: { op: "=", value: product.masp } },
          })
          .then((res) =>
            res.rows
              .map((row) => detailShape(dinhmuc, product.masp, row.data as Record<string, unknown>))
              .filter((row) => row.code),
          )
          .catch(() => [] as DetailRow[]),
      ),
    )
      .then((groups) => {
        if (alive) setRows(groups.flat());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dinhmuc, entity, products]);

  const filtered = useMemo(() => {
    const needle = normalizeVi(query.trim());
    if (!needle) return rows;
    return rows.filter((row) =>
      normalizeVi(`${row.productCode} ${row.code} ${row.name} ${row.spec} ${row.color}`).includes(
        needle,
      ),
    );
  }, [rows, query]);
  const productByCode = new Map(products.map((product) => [product.masp, product]));
  const grouped = products
    .map((product) => ({
      product,
      rows: filtered.filter((row) => row.productCode === product.masp),
    }))
    .filter((group) => group.rows.length > 0);
  const selectedSet = new Set(draft.map((row) => row.key));
  const toggle = (row: DetailRow) => {
    setDraft((current) =>
      current.some((item) => item.key === row.key)
        ? current.filter((item) => item.key !== row.key)
        : [...current, row],
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Chọn chi tiết cần thay đổi"
      width={1120}
      align="top"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft([])}>
            Bỏ chọn tất cả
          </Button>
          <Button variant="ghost" onClick={onClose} icon={<I.X size={14} />}>
            Đóng
          </Button>
          <Button variant="primary" onClick={() => onApply(draft)} icon={<I.Check size={14} />}>
            Đồng ý
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <I.Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: 34 }}
            placeholder="Tìm mã sản phẩm, mã chi tiết, tên chi tiết..."
          />
        </div>
        <div className="max-h-[590px] overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel-2 text-muted">
              <tr>
                <th className="w-16 px-2 py-2 text-left">Chọn</th>
                <th className="px-2 py-2 text-left">Mã chi tiết</th>
                <th className="px-2 py-2 text-left">Tên chi tiết</th>
                <th className="px-2 py-2 text-left">Quy cách</th>
                <th className="px-2 py-2 text-left">Màu sắc</th>
                <th className="px-2 py-2 text-right">Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ product, rows: groupRows }) => (
                <Fragment key={product.masp}>
                  <tr key={`${product.masp}:group`} className="bg-bg-soft font-semibold">
                    <td colSpan={6} className="px-2 py-2">
                      Mã sản phẩm: {product.masp}
                      {productByCode.get(product.masp)?.tensp ? ` - ${product.tensp}` : ""}
                    </td>
                  </tr>
                  {groupRows.map((row) => (
                    <tr key={row.key} className="border-t border-border hover:bg-hover">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.key)}
                          onChange={() => toggle(row)}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{row.code}</td>
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className="px-2 py-1.5">{row.spec}</td>
                      <td className="px-2 py-1.5">{row.color}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.qty}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {loading && <div className="p-3 text-xs text-muted">Đang tải chi tiết...</div>}
          {!loading && grouped.length === 0 && (
            <div className="p-6 text-center text-sm text-muted">
              Không có chi tiết theo sản phẩm đã chọn
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
