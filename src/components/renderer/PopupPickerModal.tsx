/* ==========================================================
   PopupPickerModal — Modal chọn / nhập dữ liệu được kích hoạt
   bởi ActionStep "open-popup".

   3 chế độ:
   - list   : Hiển thị bảng record, click hàng → trả về object
   - detail : Hiển thị chi tiết 1 record (theo recordId), "Chọn" → trả về
   - form   : Form trống, người dùng nhập, "Xác nhận" → trả về object
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import type { FilterOp as RecordFilterOp } from "@erp-framework/core";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { I } from "@/components/Icons";
import { FileCell, ImageCell } from "@/components/renderer/FilePreviewModal";
import {
  Button,
  Input,
  Modal,
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui";
import { normalizeVi } from "@/lib/text-utils";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionStepOpenPopup } from "@/types/page";
import { MultiLookupPicker } from "./MultiLookupPicker";

/** Tối đa dòng render trong bảng list — cap để DOM không lag khi tập kết quả lớn. */
const LIST_ROW_CAP = 200;

/** Ngưỡng bản ghi: nhỏ hơn → lọc client; lớn hơn → tìm server-side (debounce). */
const LOOKUP_THRESHOLD = 300;

type PopupImageFile = {
  id: string;
  url: string;
  name: string;
  saved?: boolean;
  uploading?: boolean;
};

type DetailImageFile = {
  id: string;
  url: string;
  name: string;
};

function isSelectOption(option: SearchableSelectOption | null): option is SearchableSelectOption {
  return option !== null;
}

function splitLookupValues(value: unknown, separator = ","): string[] {
  return String(value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function filenameFromUrl(url: string): string {
  const path = url.split("?")[0] ?? url;
  return decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? url);
}

/** Combobox cho 1 field lookup trong form popup.
 *  Tự quyết small/large: tải sẵn ≤LOOKUP_THRESHOLD → lọc client (zero re-fetch);
 *  entity lớn → gõ debounce 350ms → tìm server-side, huỷ request cũ khi gõ tiếp. */
function PopupLookupSelect({
  entity,
  valueField,
  labelField,
  value,
  onChange,
}: {
  entity: string;
  valueField: string;
  labelField: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [opts, setOpts] = useState<Array<{ value: string; label: string }>>([]);
  const [isLarge, setIsLarge] = useState(false);
  const [searching, setSearching] = useState(false);
  // term gõ — cập nhật đồng bộ (ô không lag); fetch chạy qua debounce 350ms
  const [q, setQ] = useState("");
  // Giữ preload để khôi phục khi q xoá trống (không fetch lại)
  const preloadRef = useRef<Array<{ value: string; label: string }>>([]);

  // Tải sẵn ban đầu: limit THRESHOLD+1 → quyết small/large
  useEffect(() => {
    let alive = true;
    api
      .getRecords(entity, { limit: LOOKUP_THRESHOLD + 1 })
      .then((res) => {
        if (!alive) return;
        const large = res.rows.length > LOOKUP_THRESHOLD;
        setIsLarge(large);
        const preload = (large ? res.rows.slice(0, LOOKUP_THRESHOLD) : res.rows)
          .map((r) => {
            const d = r.data as Record<string, unknown>;
            const val = d[valueField];
            const lbl = d[labelField];
            return {
              value: val == null ? "" : String(val),
              label: lbl == null ? String(val ?? "") : String(lbl),
            };
          })
          .filter((o) => o.value !== "")
          .sort((a, b) => a.label.localeCompare(b.label, "vi"));
        preloadRef.current = preload;
        setOpts(preload);
      })
      .catch(() => {
        if (alive) setOpts([]);
      });
    return () => {
      alive = false;
    };
  }, [entity, valueField, labelField]);

  // Server-search (chỉ khi entity lớn): debounce 350ms, huỷ request cũ khi gõ tiếp.
  useEffect(() => {
    if (!isLarge) return;
    const term = q.trim();
    if (!term) {
      // Xoá term → khôi phục preload, không cần fetch lại
      setOpts(preloadRef.current);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      setSearching(true);
      api
        .getRecords(entity, {
          filters: { [labelField]: { op: "contains", value: term } },
          limit: 40,
        })
        .then((res) => {
          if (!alive) return;
          setOpts(
            res.rows
              .map((r) => {
                const d = r.data as Record<string, unknown>;
                const val = d[valueField];
                const lbl = d[labelField];
                return {
                  value: val == null ? "" : String(val),
                  label: lbl == null ? String(val ?? "") : String(lbl),
                };
              })
              .filter((o) => o.value !== ""),
          );
          setSearching(false);
        })
        .catch(() => {
          if (alive) setSearching(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, isLarge, entity, valueField, labelField]);

  return (
    <SearchableSelect
      className="w-full"
      value={value}
      onChange={onChange}
      options={opts}
      emptyOption="— chọn —"
      onSearch={isLarge ? setQ : undefined}
      loading={isLarge ? searching : undefined}
    />
  );
}

const api = createApiDataSource("");

function PopupRichLookupSelect({
  entity,
  valueField,
  labelField,
  labelFields,
  columnHeaders,
  searchFields,
  multiple,
  separator,
  preloadLimit,
  filters,
  linkedData,
  value,
  onChange,
}: {
  entity: string;
  valueField: string;
  labelField: string;
  labelFields?: string[];
  columnHeaders?: string[];
  searchFields?: string[];
  multiple?: boolean;
  separator?: string;
  preloadLimit?: number;
  filters?: NonNullable<ActionStepOpenPopup["lookups"]>[number]["filters"];
  linkedData?: Record<string, unknown>;
  value: string;
  onChange: (v: string, rec?: Record<string, unknown>) => void;
}) {
  const labels = useMemo(() => {
    const unique = new Set([...(labelFields ?? []), labelField || valueField]);
    return [...unique].filter(Boolean);
  }, [labelFields, labelField, valueField]);
  const multiCol = labels.length >= 2;
  const [opts, setOpts] = useState<SearchableSelectOption[]>([]);
  const rowsByValueRef = useRef<Record<string, Record<string, unknown>>>({});
  const [isLarge, setIsLarge] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const preloadRef = useRef<SearchableSelectOption[]>([]);
  const queryFilters = useMemo(() => {
    const out: Record<string, { op: RecordFilterOp; value: unknown }> = {};
    for (const [field, cond] of Object.entries(filters ?? {})) {
      const rawValue = cond.fromLinked ? linkedData?.[cond.fromLinked] : cond.value;
      if (rawValue == null || rawValue === "") continue;
      const values = cond.split ? splitLookupValues(rawValue, cond.split) : rawValue;
      if (Array.isArray(values) && values.length === 0) continue;
      out[field] = { op: cond.op ?? "=", value: values };
    }
    return Object.keys(out).length ? out : undefined;
  }, [filters, linkedData]);

  const toOption = useCallback(
    (data: Record<string, unknown>): SearchableSelectOption | null => {
      const rawValue = data[valueField];
      if (rawValue == null || String(rawValue) === "") return null;
      const valueText = String(rawValue);
      const cells = multiCol ? labels.map((field) => String(data[field] ?? "")) : undefined;
      const labelText =
        labels
          .map((field) => data[field])
          .filter((item) => item != null && String(item) !== "")
          .join(" — ") || valueText;
      rowsByValueRef.current[valueText] = data;
      return cells
        ? { value: valueText, label: labelText, cells, searchText: cells.join(" ") }
        : { value: valueText, label: labelText };
    },
    [labels, multiCol, valueField],
  );

  useEffect(() => {
    if (!entity) return;
    let alive = true;
    const limit = preloadLimit ?? (multiple ? 2500 : LOOKUP_THRESHOLD + 1);
    api
      .getRecords(entity, { limit, ...(queryFilters ? { filters: queryFilters } : {}) })
      .then((res) => {
        if (!alive) return;
        rowsByValueRef.current = {};
        const large = !multiple && preloadLimit == null && res.rows.length > LOOKUP_THRESHOLD;
        setIsLarge(large);
        const preload = (large ? res.rows.slice(0, LOOKUP_THRESHOLD) : res.rows)
          .map((r) => toOption(r.data as Record<string, unknown>))
          .filter(isSelectOption)
          .sort((a, b) => a.label.localeCompare(b.label, "vi"));
        preloadRef.current = preload;
        setOpts(preload);
      })
      .catch(() => {
        if (alive) setOpts([]);
      });
    return () => {
      alive = false;
    };
  }, [entity, multiple, preloadLimit, queryFilters, toOption]);

  useEffect(() => {
    if (!isLarge) return;
    const term = q.trim();
    if (!term) {
      setOpts(preloadRef.current);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      setSearching(true);
      Promise.all(
        (searchFields?.length ? searchFields : [labelField]).map((field) =>
          api
            .getRecords(entity, {
              filters: {
                ...(queryFilters ?? {}),
                [field]: { op: "contains", value: term },
              },
              limit: 40,
            })
            .then((res) => res.rows)
            .catch(() => []),
        ),
      ).then((groups) => {
        if (!alive) return;
        const seen = new Set<string>();
        const merged = groups.flat().filter((row) => {
          const key = String((row.data as Record<string, unknown>)[valueField] ?? row.id);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setOpts(
          merged.map((r) => toOption(r.data as Record<string, unknown>)).filter(isSelectOption),
        );
        setSearching(false);
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, isLarge, entity, labelField, queryFilters, searchFields, toOption, valueField]);

  const handlePick = (nextValue: string) => {
    onChange(nextValue, rowsByValueRef.current[nextValue]);
  };

  if (multiple) {
    return (
      <MultiLookupPicker
        value={value}
        onChange={(nextValue) => {
          const firstValue = nextValue
            .split(separator ?? ",")
            .map((item) => item.trim())
            .filter(Boolean)[0];
          onChange(nextValue, firstValue ? rowsByValueRef.current[firstValue] : undefined);
        }}
        options={opts}
        title="đơn hàng"
        separator={separator}
        columnHeaders={columnHeaders ?? labels}
      />
    );
  }

  if (!labelFields?.length && !columnHeaders?.length && preloadLimit == null) {
    return (
      <PopupLookupSelect
        entity={entity}
        valueField={valueField}
        labelField={labelField}
        value={value}
        onChange={(nextValue) => onChange(nextValue)}
      />
    );
  }

  return (
    <SearchableSelect
      className="w-full"
      value={value}
      onChange={handlePick}
      options={opts}
      emptyOption="— chọn —"
      onSearch={isLarge ? setQ : undefined}
      loading={isLarge ? searching : undefined}
      columnHeaders={multiCol ? (columnHeaders ?? labels) : undefined}
    />
  );
}

interface Props {
  step: ActionStepOpenPopup;
  recordId?: unknown;
  /** (list) Lọc server-side đã resolve: field → giá trị (op "="). */
  filters?: Record<string, unknown>;
  linkedData?: Record<string, unknown>;
  onSelect: (value: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function PopupPickerModal({
  step,
  recordId,
  filters,
  linkedData,
  onSelect,
  onCancel,
}: Props) {
  const entities = useUserObjects((s) => s.entities);
  const entity = entities.find((e) => e.id === step.entity);

  const usableFields = (entity?.fields ?? []).filter(
    (f) => f.type !== "formula" && f.type !== "collection",
  );
  const entityFieldNames = useMemo(() => new Set(usableFields.map((f) => f.name)), [usableFields]);
  // step.fields → đúng tập + thứ tự đó; không có → tối đa 7 field đầu.
  // step.fieldOverrides → ghi đè type/label (vd url→file, text→image).
  const visibleFields = (
    step.fields && step.fields.length > 0
      ? (step.fields
          .map((n) => {
            const found = usableFields.find((f) => f.name === n);
            if (found) return found;
            const ov = step.fieldOverrides?.[n];
            if (!ov) return null;
            return {
              id: `virtual_${n}`,
              name: n,
              type: ov.type ?? "text",
              label: ov.label ?? step.columnLabels?.[n] ?? n,
            };
          })
          .filter(Boolean) as typeof usableFields)
      : usableFields.slice(0, 7)
  ).map((f) => {
    const ov = step.fieldOverrides?.[f.name];
    return {
      ...f,
      ...(step.columnLabels?.[f.name] ? { label: step.columnLabels[f.name] } : {}),
      ...(ov?.type ? { type: ov.type } : {}),
      ...(ov?.label ? { label: ov.label } : {}),
    };
  });

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  // Map field name → lookup config từ step — tra O(1) trong render (thay cho lookupOpts + effect)
  const lookupCfgByField = useMemo(
    () => Object.fromEntries((step.lookups ?? []).map((l) => [l.field, l])),
    [step.lookups],
  );
  // (list) Map nhãn cho cột lookup: { fieldName → { giá trị lưu → nhãn } }.
  const [listLabels, setListLabels] = useState<Record<string, Record<string, string>>>({});
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);
  const [detailImagesByField, setDetailImagesByField] = useState<Record<string, DetailImageFile[]>>(
    {},
  );
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [imageFilesByField, setImageFilesByField] = useState<Record<string, PopupImageFile[]>>({});
  const [uploadingImages, setUploadingImages] = useState<Record<string, boolean>>({});
  const handleFieldChange = (name: string, val: string, lookupRow?: Record<string, unknown>) => {
    setFormValues((v) => {
      const next = { ...v, [name]: val };
      const lookup = lookupCfgByField[name];
      if (lookup?.autofill && lookupRow) {
        for (const [targetField, sourceField] of Object.entries(lookup.autofill)) {
          const sourceValue = lookupRow[sourceField];
          next[targetField] = sourceValue == null ? "" : String(sourceValue);
        }
      } else if (name === "madonhang" && val) {
        // Tự động map hệ hàng và khách hàng khi chọn mã đơn hàng
        const parts = val.split("-").map((p) => p.trim());
        if (parts.length >= 4) {
          next.khachhang = parts[2] ?? "";
          next.hehang = parts[3] ?? "";
        } else if (parts.length === 3) {
          next.hehang = parts[2] ?? "";
        }
      }
      return next;
    });
  };
  const onPickMultipleImages = (
    name: string,
    files: FileList | null | undefined,
    subfolder = "bao-cao-final",
  ) => {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    const valid: Array<{ id: string; file: File; preview: string }> = [];
    for (const file of picked) {
      if (!file.type.startsWith("image/")) {
        toast.error("Chỉ chấp nhận file ảnh");
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`Ảnh ${file.name} không được vượt quá 10MB`);
        continue;
      }
      valid.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    if (valid.length === 0) return;
    setFormValues((v) => ({ ...v, [name]: valid[0]?.preview ?? "" }));

    setImageFilesByField((current) => ({
      ...current,
      [name]: [
        ...(current[name] ?? []),
        ...valid.map(({ id, file, preview }) => ({
          id,
          url: preview,
          name: file.name,
          uploading: true,
        })),
      ],
    }));
    setUploadingImages((v) => ({ ...v, [name]: true }));

    const uploadOne = async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const url = subfolder ? `/upload/image/${encodeURIComponent(subfolder)}` : "/upload/image";
      const res = await fetch(url, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload thất bại" }));
        throw new Error((err as { error?: string }).error ?? "Upload thất bại");
      }
      const json = (await res.json()) as { url: string };
      setFormValues((v) => (v[name]?.startsWith("blob:") ? { ...v, [name]: json.url } : v));
      setImageFilesByField((current) => ({
        ...current,
        [name]: (current[name] ?? []).map((item) =>
          item.id === id ? { ...item, url: json.url, uploading: false } : item,
        ),
      }));
    };

    Promise.allSettled(valid.map(uploadOne)).then((results) => {
      const failed = new Set<string>();
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const failedId = valid[index]?.id;
          if (failedId) failed.add(failedId);
          toast.error((result.reason as Error).message);
        }
      });
      if (failed.size > 0) {
        setImageFilesByField((current) => ({
          ...current,
          [name]: (current[name] ?? []).filter((item) => !failed.has(item.id)),
        }));
      }
      setUploadingImages((v) => {
        const next = { ...v };
        delete next[name];
        return next;
      });
    });
  };
  // Dữ liệu record nạp sẵn cho form "Sửa" (có recordId). null = form thêm mới.
  const [formSeed, setFormSeed] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // (list multiSelect) tập id dòng đang chọn.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const multi = step.popupMode === "list" && step.multiSelect === true;
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const attachmentItemValues = (
    owner: Record<string, unknown>,
    att: NonNullable<ActionStepOpenPopup["imageAttachments"]>[number],
  ) => {
    const values = [owner[att.itemValueField ?? "item_id"], owner.item_id, owner.id];
    return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  };

  const loadAttachmentImages = async (
    owner: Record<string, unknown>,
  ): Promise<Record<string, DetailImageFile[]>> => {
    const pairs = await Promise.all(
      (step.imageAttachments ?? []).map(async (att) => {
        const itemValues = attachmentItemValues(owner, att);
        if (itemValues.length === 0) return [att.field, []] as const;
        const imageRows = await Promise.all(
          itemValues.map((itemValue) =>
            api
              .getRecords(att.entity, {
                limit: 100,
                filters: {
                  [att.itemField]: { op: "=", value: itemValue },
                },
              })
              .then((res) => res.rows)
              .catch(() => []),
          ),
        );
        const seen = new Set<string>();
        const images = imageRows
          .flat()
          .filter((row) => {
            if (seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
          })
          .map((row) => {
            const data = row.data as Record<string, unknown>;
            const url = String(data[att.pathField] ?? "");
            if (!url) return null;
            return {
              id: row.id,
              url,
              name: String(data[att.nameField] ?? filenameFromUrl(url)),
            };
          })
          .filter((item): item is DetailImageFile => item !== null);
        return [att.field, images] as const;
      }),
    );
    return Object.fromEntries(pairs);
  };

  // Khoá ổn định cho filters (object đổi identity mỗi render) → tránh refetch loop.
  const filtersKey = JSON.stringify(filters ?? null);

  /* Fetch records (list) / record đơn (detail) / record nạp form sửa (form+recordId) */
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters dùng qua filtersKey (khoá JSON ổn định) thay vì object identity
  useEffect(() => {
    if (!step.entity) return;
    // Form THÊM mới (không recordId) → không fetch; effect init rỗng bên dưới lo.
    if (step.popupMode === "form" && recordId == null) return;

    if (step.popupMode === "list") {
      setLoading(true);
      // Lọc server-side theo filters (op "=") — vd chỉ sản phẩm cùng màu phiên bản.
      const f = filters
        ? Object.fromEntries(
            Object.entries(filters).map(([k, v]) => [k, { op: "=" as const, value: v }]),
          )
        : undefined;
      const sort = step.listSort
        ? { sort: { field: step.listSort.field, dir: step.listSort.dir ?? "asc" } }
        : {};
      api
        .getRecords(step.entity, { limit: 500, ...(f ? { filters: f } : {}), ...sort })
        .then((res) => setRows(res.rows.map((r) => ({ ...r.data, id: r.id }))))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
      return;
    } else if ((step.popupMode === "detail" || step.popupMode === "form") && recordId != null) {
      // Sửa: nạp record hiện tại → seed form (effect init bên dưới đổ vào input).
      setLoading(true);
      setDetailRow(null);
      setFormSeed(null);
      api
        .getRecord(String(recordId))
        .then((rec) => {
          const row = rec ? { ...(rec.data as Record<string, unknown>), id: rec.id } : null;
          if (step.popupMode === "detail") setDetailRow(row);
          else setFormSeed(row);
        })
        .catch(() => {
          setDetailRow(null);
          setFormSeed(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [step.entity, step.popupMode, recordId, filtersKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadAttachmentImages là helper nội bộ, effect chỉ cần chạy theo record/step hiện tại
  useEffect(() => {
    if (step.popupMode !== "detail" || !detailRow || !step.imageAttachments?.length) {
      setDetailImagesByField({});
      return;
    }
    let alive = true;
    loadAttachmentImages(detailRow).then((imagesByField) => {
      if (alive) setDetailImagesByField(imagesByField);
    });
    return () => {
      alive = false;
    };
  }, [step.popupMode, step.imageAttachments, detailRow]);

  /* Khởi tạo form: rỗng (thêm mới) hoặc đổ từ formSeed (sửa). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chu y chi reset form khi doi popupMode/entity/seed, khong reset khi visibleFields thay doi de tranh xoa input dang nhap
  useEffect(() => {
    if (step.popupMode !== "form") return;
    const init: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = formSeed?.[f.name];
      init[f.name] = v == null ? "" : String(v);
    }
    setFormValues(init);
    setImageFilesByField({});
    if (!formSeed || !step.imageAttachments?.length) return;
    let alive = true;
    loadAttachmentImages(formSeed).then((imagesByField) => {
      if (!alive) return;
      setImageFilesByField(
        Object.fromEntries(
          Object.entries(imagesByField).map(([field, images]) => [
            field,
            images.map((image) => ({ ...image, saved: true })),
          ]),
        ),
      );
      setFormValues((current) => {
        const next = { ...current };
        for (const [field, images] of Object.entries(imagesByField)) {
          if (!next[field] && images[0]?.url) next[field] = images[0].url;
        }
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [step.entity, step.popupMode, formSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  /* (list) Nạp nhãn cho cột lookup (vd bom_son_version_id → mã phiên bản). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi đổi popupMode/entity; step.listLookups ổn định theo lần mở popup
  useEffect(() => {
    const lks = step.listLookups ?? [];
    if (step.popupMode !== "list" || lks.length === 0) return;
    let alive = true;
    Promise.all(
      lks.map(async (lk) => {
        const vf = lk.valueField ?? "id";
        try {
          const res = await api.getRecords(lk.entity, { limit: 2000 });
          const map: Record<string, string> = {};
          for (const r of res.rows) {
            const d = r.data as Record<string, unknown>;
            const val = vf === "id" ? r.id : d[vf];
            const lbl = d[lk.labelField];
            if (val != null) map[String(val)] = lbl == null ? String(val) : String(lbl);
          }
          return [lk.field, map] as const;
        } catch {
          return [lk.field, {} as Record<string, string>] as const;
        }
      }),
    ).then((pairs) => {
      if (alive) setListLabels(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [step.popupMode, step.entity]);

  const onConfirmForm = async () => {
    const data: Record<string, unknown> = {};
    for (const f of visibleFields) {
      if (!entityFieldNames.has(f.name)) continue;
      const raw = formValues[f.name] ?? "";
      if (f.type === "boolean" || f.type === "bool") data[f.name] = raw === "true";
      else if (f.type === "number" || f.type === "integer" || f.type === "currency") {
        data[f.name] = raw === "" ? null : Number(raw);
      } else {
        data[f.name] = raw;
      }
    }

    const saveImageAttachments = async (owner: Record<string, unknown>) => {
      for (const att of step.imageAttachments ?? []) {
        let itemValue = owner[att.itemValueField ?? "item_id"] ?? owner.id;
        if (!itemValue && owner.id) itemValue = owner.id;
        if (!itemValue) continue;
        const images = imageFilesByField[att.field] ?? [];
        for (const image of images) {
          if (image.saved || image.uploading || image.url.startsWith("blob:")) continue;
          await api.createRecord(att.entity, {
            [att.itemField]: itemValue,
            [att.pathField]: image.url,
            [att.nameField]: image.name || filenameFromUrl(image.url),
          });
          image.saved = true;
        }
      }
    };

    if (!step.persist) {
      onSelect(data);
      return;
    }

    setSaving(true);
    try {
      if (recordId != null) {
        await api.updateRecord(String(recordId), data);
        const updated = { ...(formSeed ?? {}), ...data, id: recordId };
        await saveImageAttachments(updated);
        onSelect(updated);
      } else {
        const linkedPayload = Object.fromEntries(
          Object.entries(linkedData ?? {}).filter(([field]) => entityFieldNames.has(field)),
        );
        const payload = { ...data, ...linkedPayload };
        const created = await api.createRecord(step.entity, payload);
        const createdData: Record<string, unknown> = {
          ...payload,
          ...(created.data as Record<string, unknown>),
          id: created.id,
        };
        if (step.imageAttachments?.length && !createdData.item_id) {
          await api.updateRecord(created.id, { item_id: created.id });
          createdData.item_id = created.id;
        }
        await saveImageAttachments(createdData);
        onSelect(createdData);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmMulti = () => {
    const ids = [...selected];
    const items = rows.filter((r) => ids.includes(String(r.id)));
    onSelect({ __many: true, ids, items });
  };

  const defaultTitle =
    step.popupMode === "list"
      ? `Chọn ${entity?.name ?? "bản ghi"}`
      : step.popupMode === "detail"
        ? `Chi tiết ${entity?.name ?? ""}`
        : `Nhập ${entity?.name ?? ""}`;
  const title = step.title || defaultTitle;

  // Precompute text bỏ-dấu 1 lần/row (gộp mọi visible field) — không normalize lại mỗi phím gõ.
  const rowNormIndex = useMemo(
    () => rows.map((r) => normalizeVi(visibleFields.map((f) => String(r[f.name] ?? "")).join(" "))),
    [rows, visibleFields],
  );
  // Defer search → lọc+render chạy nền, ô tìm không bị chặn khi table lớn.
  const deferredSearch = useDeferredValue(search);
  const filteredRows = useMemo(() => {
    if (!deferredSearch) return rows;
    const q = normalizeVi(deferredSearch);
    return rows.filter((_, i) => (rowNormIndex[i] ?? "").includes(q));
  }, [rows, rowNormIndex, deferredSearch]);
  // Chỉ render tối đa LIST_ROW_CAP dòng — bảng lớn không vẽ hết vào DOM.
  const shownRows =
    filteredRows.length > LIST_ROW_CAP ? filteredRows.slice(0, LIST_ROW_CAP) : filteredRows;
  const tableOverflow = filteredRows.length - shownRows.length;

  // Form rộng hơn để chứa 2 cột trên màn lớn; list 760; detail 520.
  // Modal cap theo viewport (w-full + maxWidth) nên màn nhỏ tự co lại.
  const modalWidth = step.popupMode === "list" ? 760 : step.popupMode === "form" ? 720 : 520;
  const hasUploadingImage = Object.values(uploadingImages).some(Boolean);
  const removePickedImage = (fieldName: string, imageId: string) => {
    setImageFilesByField((current) => {
      const nextImages = (current[fieldName] ?? []).filter((item) => item.id !== imageId);
      setFormValues((values) => ({ ...values, [fieldName]: nextImages[0]?.url ?? "" }));
      return { ...current, [fieldName]: nextImages };
    });
  };
  const clearPickedImages = (fieldName: string) => {
    setFormValues((values) => ({ ...values, [fieldName]: "" }));
    setImageFilesByField((current) => ({ ...current, [fieldName]: [] }));
  };

  const renderDetailImages = (images: DetailImageFile[]) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {images.map((image, index) => (
        <div key={image.id} className="overflow-hidden rounded border border-border bg-panel-2">
          <ImageCell url={image.url} className="h-24 w-full object-contain" />
          <div className="border-t border-border px-1.5 py-1 text-[10px] text-muted">
            {index + 1}. {image.name}
          </div>
        </div>
      ))}
    </div>
  );

  const renderImageField = (f: (typeof visibleFields)[number]) => {
    const images = imageFilesByField[f.name] ?? [];
    const hasImages = images.length > 0 || !!formValues[f.name];
    return (
      <div className="space-y-2">
        {images.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((image, index) => (
              <div
                key={image.id}
                className="group relative overflow-hidden rounded border border-border bg-panel-2"
              >
                <img src={image.url} alt={image.name} className="h-24 w-full object-contain" />
                {image.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-bg/70 text-xs text-muted">
                    <I.Loader size={14} className="animate-spin" />
                  </div>
                )}
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] text-danger opacity-0 shadow-sm transition group-hover:opacity-100"
                  onClick={() => removePickedImage(f.name, image.id)}
                >
                  Xoá
                </button>
                <div className="border-t border-border px-1.5 py-1 text-[10px] text-muted">
                  {index + 1}. {image.name}
                </div>
              </div>
            ))}
          </div>
        ) : formValues[f.name] ? (
          <img
            src={formValues[f.name]}
            alt=""
            className="h-28 max-w-full object-contain rounded border border-border bg-panel-2"
          />
        ) : (
          <div className="h-28 flex items-center justify-center text-xs text-muted border border-dashed border-border rounded">
            Chưa có ảnh
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            multiple
            className="text-xs"
            onChange={(e) => {
              onPickMultipleImages(
                f.name,
                e.target.files,
                step.imageAttachments?.find((att) => att.field === f.name)?.subfolder,
              );
              e.currentTarget.value = "";
            }}
          />
          {images.length > 0 && (
            <span className="text-xs text-muted">Đã chọn {images.length} ảnh</span>
          )}
          {uploadingImages[f.name] && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <I.Loader size={12} className="animate-spin" />
              Đang tải...
            </span>
          )}
          {hasImages && (
            <button
              type="button"
              className="text-xs text-danger hover:underline"
              onClick={() => clearPickedImages(f.name)}
            >
              Xoá ảnh
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      width={modalWidth}
      footer={
        step.popupMode === "form" ? (
          <>
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              onClick={onConfirmForm}
              disabled={saving || loading || hasUploadingImage}
            >
              {saving ? "Đang lưu..." : step.persist ? "Lưu" : "Xác nhận"}
            </Button>
          </>
        ) : step.popupMode === "detail" ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              disabled={!detailRow}
              onClick={() => detailRow && onSelect(detailRow)}
            >
              Chọn
            </Button>
          </>
        ) : multi ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button variant="primary" disabled={selected.size === 0} onClick={confirmMulti}>
              Áp dụng ({selected.size})
            </Button>
          </>
        ) : null
      }
    >
      {/* ── LIST ─────────────────────────────────────────────── */}
      {step.popupMode === "list" && (
        <div className="space-y-3">
          <div className="relative">
            <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm..."
              className="pl-7!"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">Không có dữ liệu</div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel-2 border-b border-border">
                    <tr>
                      {multi && (
                        <th className="w-9 px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Chọn tất cả"
                            checked={
                              filteredRows.length > 0 &&
                              filteredRows.every((r) => selected.has(String(r.id)))
                            }
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? new Set(filteredRows.map((r) => String(r.id)))
                                  : new Set(),
                              )
                            }
                          />
                        </th>
                      )}
                      {visibleFields.map((f) => (
                        <th
                          key={f.id}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap"
                        >
                          {f.label}
                        </th>
                      ))}
                      {!multi && <th className="w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row, i) => {
                      const rid = String(row.id);
                      const isSel = multi && selected.has(rid);
                      return (
                        <tr
                          // biome-ignore lint/suspicious/noArrayIndexKey: row la Record dong, khong dam bao co id on dinh; chi so hang la danh tinh hien thi
                          key={i}
                          className={`border-t border-border cursor-pointer group/row ${isSel ? "bg-accent/10" : "hover:bg-hover"}`}
                          onClick={() => (multi ? toggleSel(rid) : onSelect(row))}
                        >
                          {multi && (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label="Chọn dòng"
                                checked={isSel}
                                onChange={() => toggleSel(rid)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                          )}
                          {visibleFields.map((f) => {
                            const raw = String(row[f.name] ?? "");
                            const disp = listLabels[f.name]?.[raw] ?? raw;
                            return (
                              <td
                                key={f.id}
                                className="px-3 py-2 max-w-[180px] truncate"
                                title={disp}
                              >
                                {disp}
                              </td>
                            );
                          })}
                          {!multi && (
                            <td className="pr-2 text-right">
                              <span className="text-[10px] text-accent opacity-0 group-hover/row:opacity-100">
                                Chọn →
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {tableOverflow > 0 && (
                      <tr>
                        <td
                          colSpan={visibleFields.length + (multi ? 1 : 0) + (!multi ? 1 : 0)}
                          className="px-3 py-1.5 text-xs text-muted/70 italic border-t border-border/50"
                        >
                          Còn {tableOverflow} dòng — gõ thêm để thu hẹp…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-1.5 text-[11px] text-muted border-t border-border bg-panel-2">
                {filteredRows.length} bản ghi
                {search && rows.length !== filteredRows.length && ` (${rows.length} tổng)`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL ───────────────────────────────────────────── */}
      {step.popupMode === "detail" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : !detailRow ? (
            <div className="text-center py-12 text-muted text-sm">Không tìm thấy bản ghi</div>
          ) : (
            <div className="divide-y divide-border">
              {visibleFields.map((f) => {
                const raw = detailRow[f.name];
                const s = raw == null ? "" : String(raw);
                const attachedImages = detailImagesByField[f.name] ?? [];
                let cell: ReactNode;
                if (attachedImages.length > 0) {
                  cell = renderDetailImages(attachedImages);
                } else if (
                  f.type === "image" &&
                  s &&
                  (s.startsWith("data:image/") ||
                    s.startsWith("/files/img/") ||
                    s.startsWith("/f/") ||
                    /^https?:\/\//.test(s))
                ) {
                  cell = (
                    <ImageCell url={s} className="h-16 max-w-[160px] object-contain rounded" />
                  );
                } else if (
                  f.type === "file" &&
                  (s.startsWith("/files/doc/") || s.startsWith("/f/"))
                ) {
                  cell = <FileCell url={s} />;
                } else {
                  cell = <span className="font-medium break-words">{s || "—"}</span>;
                }
                return (
                  <div key={f.id} className="grid grid-cols-[160px_1fr] gap-3 py-2.5 text-sm">
                    <span className="text-muted text-xs pt-0.5">{f.label}</span>
                    {cell}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FORM ─────────────────────────────────────────────── */}
      {step.popupMode === "form" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : visibleFields.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">Entity chưa có field nào</div>
          ) : (
            visibleFields.map((f) => (
              <div key={f.id} className="space-y-1">
                <label className="text-xs font-medium">
                  {f.label}
                  {f.required && <span className="text-danger ml-0.5">*</span>}
                </label>
                {f.type === "image" ? (
                  renderImageField(f)
                ) : lookupCfgByField[f.name]?.options?.length ? (
                  // Options tĩnh (value≠label) — không cần fetch
                  <SearchableSelect
                    className="w-full"
                    value={formValues[f.name] ?? ""}
                    onChange={(val) => handleFieldChange(f.name, val)}
                    options={lookupCfgByField[f.name]?.options ?? []}
                    emptyOption="— chọn —"
                  />
                ) : lookupCfgByField[f.name]?.entity ? (
                  // Lookup từ entity: small → lọc client; large → tìm server-side debounce
                  <PopupRichLookupSelect
                    entity={lookupCfgByField[f.name]?.entity ?? ""}
                    valueField={lookupCfgByField[f.name]?.valueField ?? "id"}
                    labelField={lookupCfgByField[f.name]?.labelField ?? "id"}
                    labelFields={lookupCfgByField[f.name]?.labelFields}
                    columnHeaders={lookupCfgByField[f.name]?.columnHeaders}
                    searchFields={lookupCfgByField[f.name]?.searchFields}
                    multiple={lookupCfgByField[f.name]?.multiple}
                    separator={lookupCfgByField[f.name]?.separator}
                    preloadLimit={lookupCfgByField[f.name]?.preloadLimit}
                    filters={lookupCfgByField[f.name]?.filters}
                    linkedData={linkedData}
                    value={formValues[f.name] ?? ""}
                    onChange={(val, row) => handleFieldChange(f.name, val, row)}
                  />
                ) : f.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formValues[f.name] === "true"}
                      onChange={(e) =>
                        handleFieldChange(f.name, e.target.checked ? "true" : "false")
                      }
                    />
                    {f.label}
                    {f.required && <span className="text-danger ml-0.5">*</span>}
                  </label>
                ) : f.options && f.options.length > 0 ? (
                  <SearchableSelect
                    className="w-full"
                    value={formValues[f.name] ?? ""}
                    onChange={(val) => handleFieldChange(f.name, val)}
                    options={f.options.map((opt) => ({ value: opt, label: opt }))}
                    emptyOption="— chọn —"
                  />
                ) : f.type === "text" || f.type === "longtext" ? (
                  <textarea
                    className="input w-full resize-none"
                    rows={f.type === "longtext" ? 3 : 1}
                    value={formValues[f.name] ?? ""}
                    onChange={(e) => handleFieldChange(f.name, e.target.value)}
                    placeholder={f.label}
                  />
                ) : (
                  <Input
                    type={
                      f.type === "number" || f.type === "integer"
                        ? "number"
                        : f.type === "date"
                          ? "date"
                          : "text"
                    }
                    value={formValues[f.name] ?? ""}
                    onChange={(e) => handleFieldChange(f.name, e.target.value)}
                    placeholder={f.label}
                  />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
