import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { DataGrid } from "@/components/renderer/DataGrid";
import { api, usePageState } from "@/components/renderer/page-data";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { Button, EmptyState, Modal, SplitPane, TagBox } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";
import { useRbac } from "@/stores/rbac";
import type { PageComponent } from "@/components/renderer/page-types";

const ENTITY_BANGMAU = "03a7f9bb-313d-4bf4-bd7e-99ac569caadc";
const ENTITY_QUYTRINH = "74fb4a74-83dc-4fa8-989c-c4bdfe6b8d0e";
const ENTITY_SANPHAM = "b71515cf-4a57-4eed-a1f5-9275d7781c72";

function safeRandomUUID() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
}

function getInputValue(v: number | null | undefined): string | number {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return v;
}

interface PaletteRow {
  id: string;
  ma: string;
  ten: string;
  hehang: string | null;
  ghichu: string | null;
  active?: boolean;
}

interface QuyTrinhRow {
  id?: string;
  key: string;
  stt: number;
  mact: string;
  tensp?: string;
  quytrinh: string;
  dinhluong: number | null;
  somat: number | null;
  ghichu: string;
  nguyenlieu?: string;
}

interface SpRow {
  masp: string;
  tensp: string | null;
  hehang: string | null;
}

/* ── 3-dot row action menu ─────────────────────────────────────────── */
function PaletteRowMenu({
  palette,
  onEdit,
  onDelete,
}: {
  palette: PaletteRow;
  onEdit: (p: PaletteRow) => void;
  onDelete: (p: PaletteRow) => void;
}) {
  const canEdit = useRbac((s) => s.can("edit", "entity"));
  const canDelete = useRbac((s) => s.can("delete", "entity"));

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-palette-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!canEdit && !canDelete) return null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.right - 128 });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-palette-menu
        onClick={toggle}
        title="Hành động"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted hover:text-text hover:border-border transition-colors"
      >
        <I.MoreHorizontal size={14} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            data-palette-menu
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, minWidth: 128 }}
            className="bg-panel border border-border rounded-lg shadow-lg py-1 text-sm"
          >
            {canEdit && (
              <button
                type="button"
                data-palette-menu
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onEdit(palette);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-hover text-text transition-colors"
              >
                <I.Edit size={13} className="text-muted" />
                Sửa
              </button>
            )}
            {canDelete && (
              <>
                {canEdit && <div className="my-1 border-t border-border" />}
                <button
                  type="button"
                  data-palette-menu
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    void onDelete(palette);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-danger/10 text-danger transition-colors"
                >
                  <I.Trash size={13} />
                  Xóa
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function BangMauTypePage({ comp }: { comp?: PageComponent }) {
  // ── Phân quyền nhúng tại component gốc ───────────────────────
  const canCreate = useRbac((s) => s.can("create", "entity"));
  const canEdit = useRbac((s) => s.can("edit", "entity"));
  const canDelete = useRbac((s) => s.can("delete", "entity"));
  // ───────────────────────────────────────────────────────

  const pageState = usePageState();
  const panelA = comp?.config?.panelA ?? {};
  const embeddedActions = (panelA.embeddedActions ?? []) as any[];
  const rowActionsBuiltin = panelA.rowActionsBuiltin === true;

  const [palettes, setPalettes] = useState<PaletteRow[]>([]);
  const [loadingPalettes, setLoadingPalettes] = useState(true);
  const [selectedPalette, setSelectedPalette] = useState<PaletteRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Synchronize selection key with pageState for designer actions
  const selectionKey = comp?.id ? `split_${comp.id}_sel` : undefined;
  const handleSelectPalette = useCallback(
    (palette: PaletteRow | null) => {
      setSelectedPalette(palette);
      if (selectionKey) {
        pageState.set(selectionKey, palette?.id ?? null);
      }
    },
    [selectionKey, pageState],
  );

  const [quytrinhRows, setQuytrinhRows] = useState<QuyTrinhRow[]>([]);
  const [loadingQuytrinh, setLoadingQuytrinh] = useState(false);
  const [productNameMap, setProductNameMap] = useState<Map<string, string>>(new Map());

  // Suggestion list for product lines (Hệ hàng)
  const [hehangs, setHehangs] = useState<string[]>([]);

  // Modal control states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [formMa, setFormMa] = useState("");
  const [formTen, setFormTen] = useState("");
  const [formHehang, setFormHehang] = useState<string[]>([]);
  const [formGhichu, setFormGhichu] = useState("");
  const [gridRows, setGridRows] = useState<QuyTrinhRow[]>([]);
  const [initialChildIds, setInitialChildIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Inline product lookup popup state
  const [activeLookupIndex, setActiveLookupIndex] = useState<number | null>(null);
  const [lookupSearch, setLookupSearch] = useState("");
  const [lookupProducts, setLookupProducts] = useState<SpRow[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  const lookupInputRef = useRef<HTMLInputElement>(null);
  const lookupAnchorRef = useRef<HTMLDivElement>(null);
  const [lookupPos, setLookupPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);

  // Recalculate position dynamically whenever index or grid row layout changes
  useLayoutEffect(() => {
    if (activeLookupIndex === null) {
      setLookupPos(null);
      return;
    }

    const update = () => {
      const el = lookupAnchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();

      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const popupHeight = 310; // estimated max height of search popup

      const positionAbove = spaceBelow < popupHeight && spaceAbove > spaceBelow;

      const nextPos = positionAbove
        ? {
            bottom: window.innerHeight - r.top + 4,
            left: r.left,
          }
        : {
            top: r.bottom + 4,
            left: r.left,
          };

      setLookupPos(nextPos);
    };

    // Chạy update ngay sau khi render xong để đảm bảo layout của Modal đã ổn định
    const timer = setTimeout(update, 0);

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeLookupIndex]);
  // Tự động tìm kiếm sản phẩm khi người dùng nhập từ khóa (live search)
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchLookupProducts không bọc useCallback, chủ ý chỉ chạy theo lookupSearch và activeLookupIndex
  useEffect(() => {
    if (activeLookupIndex === null) return;
    const delayDebounceFn = setTimeout(() => {
      void searchLookupProducts(lookupSearch);
    }, 200);

    return () => clearTimeout(delayDebounceFn);
  }, [lookupSearch, activeLookupIndex]);

  // Fetch product line suggestion values
  useEffect(() => {
    fetch("/banvesvc/hehang", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const data = d as { rows?: Array<{ hehang: string } | string> };
        setHehangs(
          (data.rows ?? [])
            .map((r) => (typeof r === "string" ? r : r.hehang))
            .filter(Boolean) as string[],
        );
      })
      .catch(() => setHehangs([]));
  }, []);

  // Fetch palettes
  const loadPalettes = useCallback(async () => {
    setLoadingPalettes(true);
    try {
      const res = await api.getRecords(ENTITY_BANGMAU, { limit: 1000 });
      const mapped = res.rows.map((r: { id: string; data: Record<string, unknown> }) => ({
        id: r.id,
        ma: String(r.data.ma ?? ""),
        ten: String(r.data.ten ?? ""),
        hehang: r.data.hehang ? String(r.data.hehang) : null,
        ghichu: r.data.ghichu ? String(r.data.ghichu) : null,
        active: r.data.active !== false,
      }));
      // Sort alphabetically by code
      mapped.sort((a, b) => a.ma.localeCompare(b.ma, "vi"));
      setPalettes(mapped);

      // Keep selection if it exists
      if (selectedPalette) {
        const updated = mapped.find((p) => p.ma === selectedPalette.ma);
        if (updated) setSelectedPalette(updated);
      }
    } catch (e) {
      toast.error(`Không thể tải danh sách bảng màu: ${(e as Error).message}`);
    } finally {
      setLoadingPalettes(false);
    }
  }, [selectedPalette]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only load on mount
  useEffect(() => {
    void loadPalettes();
  }, []);

  // Tự động reload khi có tín hiệu refresh từ designer actions
  const refreshKey = pageState.get(`__refresh:${ENTITY_BANGMAU}`);
  useEffect(() => {
    if (refreshKey) {
      void loadPalettes();
    }
  }, [refreshKey, loadPalettes]);

  // Fetch process detail list for the selected palette
  const loadQuytrinh = useCallback(async (paletteCode: string) => {
    setLoadingQuytrinh(true);
    try {
      const res = await api.getRecords(ENTITY_QUYTRINH, {
        filters: { bangmau: { op: "=", value: paletteCode } },
        limit: 1000,
      });

      const mapped: QuyTrinhRow[] = res.rows.map(
        (r: { id: string; data: Record<string, unknown> }) => ({
          id: r.id,
          key: r.id || safeRandomUUID(),
          stt: Number(r.data.stt ?? 0),
          mact: String(r.data.mact ?? ""),
          quytrinh: String(r.data.quytrinh ?? ""),
          dinhluong: parseNumber(r.data.dinhluong),
          somat: parseNumber(r.data.somat),
          ghichu: String(r.data.ghichu ?? ""),
          nguyenlieu: String(r.data.nguyenlieu ?? ""),
        }),
      );

      // Sort by STT
      mapped.sort((a, b) => a.stt - b.stt);
      setQuytrinhRows(mapped);

      // Resolve product names
      const uniqueMacts = Array.from(new Set(mapped.map((r) => r.mact).filter(Boolean)));
      if (uniqueMacts.length > 0) {
        const prodRes = await api.getRecords(ENTITY_SANPHAM, {
          filters: { masp: { op: "in", value: uniqueMacts } },
          limit: uniqueMacts.length,
        });

        const newMap = new Map<string, string>();
        for (const p of prodRes.rows) {
          const masp = String(p.data.masp ?? "");
          const tensp = String(p.data.tensp ?? "");
          if (masp) newMap.set(masp, tensp);
        }
        setProductNameMap(newMap);
      } else {
        setProductNameMap(new Map());
      }
    } catch (e) {
      toast.error(`Không thể tải quy trình lăn UV: ${(e as Error).message}`);
    } finally {
      setLoadingQuytrinh(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPalette) {
      void loadQuytrinh(selectedPalette.ma);
    } else {
      setQuytrinhRows([]);
      setProductNameMap(new Map());
    }
  }, [selectedPalette, loadQuytrinh]);

  // Open add dialog
  const handleAddPalette = () => {
    setModalMode("add");
    setFormMa("");
    setFormTen("");
    setFormHehang([]);
    setFormGhichu("");
    setGridRows([]);
    setInitialChildIds([]);
    setIsModalOpen(true);
  };

  // Open edit dialog
  const handleEditPalette = async (palette: PaletteRow) => {
    setModalMode("edit");
    setFormMa(palette.ma);
    setFormTen(palette.ten);
    setFormHehang(
      palette.hehang
        ? palette.hehang
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean)
        : [],
    );
    setFormGhichu(palette.ghichu ?? "");

    // Load detail rows to edit
    try {
      const res = await api.getRecords(ENTITY_QUYTRINH, {
        filters: { bangmau: { op: "=", value: palette.ma } },
        limit: 1000,
      });

      const mapped: QuyTrinhRow[] = res.rows.map(
        (r: { id: string; data: Record<string, unknown> }) => ({
          id: r.id,
          key: r.id || safeRandomUUID(),
          stt: Number(r.data.stt ?? 0),
          mact: String(r.data.mact ?? ""),
          quytrinh: String(r.data.quytrinh ?? ""),
          dinhluong: parseNumber(r.data.dinhluong),
          somat: parseNumber(r.data.somat),
          ghichu: String(r.data.ghichu ?? ""),
          nguyenlieu: String(r.data.nguyenlieu ?? ""),
        }),
      );
      mapped.sort((a, b) => a.stt - b.stt);

      // Fetch product names for lookup
      const uniqueMacts = Array.from(new Set(mapped.map((r) => r.mact).filter(Boolean)));
      const nameMap = new Map<string, string>();
      if (uniqueMacts.length > 0) {
        const prodRes = await api.getRecords(ENTITY_SANPHAM, {
          filters: { masp: { op: "in", value: uniqueMacts } },
          limit: uniqueMacts.length,
        });
        for (const p of prodRes.rows) {
          const masp = String(p.data.masp ?? "");
          const tensp = String(p.data.tensp ?? "");
          if (masp) nameMap.set(masp, tensp);
        }
      }

      const rowsWithNames = mapped.map((r) => ({
        ...r,
        tensp: nameMap.get(r.mact) ?? "",
      }));

      setGridRows(rowsWithNames);
      setInitialChildIds(mapped.map((r) => r.id as string).filter(Boolean));
      setIsModalOpen(true);
    } catch (e) {
      toast.error(`Không thể tải chi tiết để sửa: ${(e as Error).message}`);
    }
  };

  // Delete palette and its children
  const handleDeletePalette = async (palette: PaletteRow) => {
    const ok = await dialog.confirm(
      `Xóa bảng màu "${palette.ma} — ${palette.ten}" và toàn bộ quy trình đi kèm?`,
    );
    if (!ok) return;

    try {
      // 1. Delete parent row
      await api.deleteRecord(palette.id);

      // 2. Query and delete child rows
      const res = await api.getRecords(ENTITY_QUYTRINH, {
        filters: { bangmau: { op: "=", value: palette.ma } },
        limit: 1000,
      });
      for (const r of res.rows) {
        await api.deleteRecord(r.id);
      }

      toast.success("Đã xóa bảng màu thành công");
      if (selectedPalette?.id === palette.id) {
        setSelectedPalette(null);
      }
      void loadPalettes();
    } catch (e) {
      toast.error(`Lỗi khi xóa bảng màu: ${(e as Error).message}`);
    }
  };

  const columnsPalettes = useMemo(
    () => {
      const cols = [
        {
          accessorKey: "ma",
          header: "Mã",
          size: 70,
          cell: (c: { getValue: () => unknown }) => (
            <span className="font-mono text-accent select-all">{String(c.getValue() ?? "")}</span>
          ),
        },
        {
          accessorKey: "ten",
          header: "Tên bảng màu",
          size: 150,
        },
        {
          accessorKey: "hehang",
          header: "Hệ hàng",
          size: 80,
        },
      ];
      if (rowActionsBuiltin) {
        cols.push({
          id: "__row_actions",
          header: "",
          size: 36,
          cell: (c: { row: { original: PaletteRow } }) => {
            const p = c.row.original;
            return (
              <PaletteRowMenu
                palette={p}
                onEdit={handleEditPalette}
                onDelete={handleDeletePalette}
              />
            );
          },
        } as any);
      }
      return cols;
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: callbacks are stable
    [rowActionsBuiltin, handleEditPalette, handleDeletePalette],
  );

  const columnsQuytrinh = useMemo(
    () => [
      {
        accessorKey: "stt",
        header: "STT",
        size: 60,
        cell: (c: { getValue: () => unknown }) => (
          <span className="font-mono font-medium text-muted">{String(c.getValue() ?? "")}</span>
        ),
      },
      {
        accessorKey: "quytrinh",
        header: "Tên quy trình",
        size: 200,
        cell: (c: { getValue: () => unknown }) => (
          <span className="font-medium text-text">{String(c.getValue() ?? "")}</span>
        ),
      },
      {
        accessorKey: "mact",
        header: "Mã chi tiết",
        size: 150,
        cell: (c: { getValue: () => unknown }) => (
          <span className="font-mono text-accent select-all">{String(c.getValue() ?? "")}</span>
        ),
      },
      {
        id: "tensp",
        header: "Tên chi tiết",
        size: 240,
        cell: (c: { row: { original: QuyTrinhRow } }) => {
          const mact = c.row.original.mact;
          return mact ? (productNameMap.get(mact) ?? "") : "";
        },
      },
      {
        accessorKey: "dinhluong",
        header: "Định lượng (g)",
        size: 120,
        cell: (c: { getValue: () => unknown }) => {
          const val = c.getValue() as number | null;
          return val !== null && val !== undefined ? val.toLocaleString("vi-VN") : "0";
        },
      },
      {
        accessorKey: "somat",
        header: "Số lớp cán/mặt",
        size: 100,
        cell: (c: { getValue: () => unknown }) => String(c.getValue() ?? "0"),
      },
      {
        accessorKey: "ghichu",
        header: "Ghi chú",
        size: 200,
        cell: (c: { getValue: () => unknown }) => String(c.getValue() ?? ""),
      },
    ],
    [productNameMap],
  );

  // Search products inside the inline lookup popup
  const searchLookupProducts = async (queryStr: string) => {
    const trimmed = queryStr.trim();
    setSearchingProducts(true);
    try {
      let rows: SpRow[] = [];
      if (!trimmed) {
        const res = await api.getRecords(ENTITY_SANPHAM, { limit: 50 });
        rows = res.rows.map((r: { id: string; data: Record<string, unknown> }) => ({
          masp: String(r.data.masp ?? ""),
          tensp: r.data.tensp ? String(r.data.tensp) : null,
          hehang: r.data.hehang ? String(r.data.hehang) : null,
        }));
      } else {
        const resQ = await api.getRecords(ENTITY_SANPHAM, {
          q: trimmed,
          limit: 50,
        });
        let rowsQ = resQ.rows.map((r: { id: string; data: Record<string, unknown> }) => ({
          masp: String(r.data.masp ?? ""),
          tensp: r.data.tensp ? String(r.data.tensp) : null,
          hehang: r.data.hehang ? String(r.data.hehang) : null,
        }));

        if (rowsQ.length === 0) {
          const [resMasp, resTensp] = await Promise.all([
            api.getRecords(ENTITY_SANPHAM, {
              filters: { masp: { op: "contains", value: trimmed } },
              limit: 50,
            }),
            api.getRecords(ENTITY_SANPHAM, {
              filters: { tensp: { op: "contains", value: trimmed } },
              limit: 50,
            }),
          ]);

          const mapRow = (r: { id: string; data: Record<string, unknown> }) => ({
            masp: String(r.data.masp ?? ""),
            tensp: r.data.tensp ? String(r.data.tensp) : null,
            hehang: r.data.hehang ? String(r.data.hehang) : null,
          });

          const rowsMasp = resMasp.rows.map(mapRow);
          const rowsTensp = resTensp.rows.map(mapRow);

          const merged = [...rowsMasp];
          const masps = new Set(merged.map((r) => r.masp));
          for (const r of rowsTensp) {
            if (!masps.has(r.masp)) {
              merged.push(r);
            }
          }
          rowsQ = merged.slice(0, 50);
        }
        rows = rowsQ;
      }
      setLookupProducts(rows);
    } catch (e) {
      toast.error(`Lỗi tìm kiếm sản phẩm: ${(e as Error).message}`);
    } finally {
      setSearchingProducts(false);
    }
  };

  // Handle saving the form
  const handleSave = async () => {
    const ma = formMa.trim();
    const ten = formTen.trim();
    if (!ma) {
      await dialog.alert("Mã bảng màu không được để trống!");
      return;
    }
    if (!ten) {
      await dialog.alert("Tên bảng màu không được để trống!");
      return;
    }

    setSaving(true);
    try {
      let parentId = "";
      if (modalMode === "add") {
        // Check duplicate code
        const isDup = palettes.some((p) => p.ma.toLowerCase() === ma.toLowerCase());
        if (isDup) {
          await dialog.alert(`Mã bảng màu "${ma}" đã tồn tại!`);
          setSaving(false);
          return;
        }

        const parentRes = (await api.createRecord(ENTITY_BANGMAU, {
          ma,
          ten,
          hehang: formHehang.length > 0 ? formHehang.join(", ") : null,
          ghichu: formGhichu || null,
          active: true,
        })) as { id: string };
        parentId = parentRes.id;
      } else {
        const found = palettes.find((p) => p.ma === ma);
        if (!found) throw new Error("Không tìm thấy bảng màu để cập nhật");
        parentId = found.id;
        await api.updateRecord(parentId, {
          ten,
          hehang: formHehang.length > 0 ? formHehang.join(", ") : null,
          ghichu: formGhichu || null,
        });
      }

      // Sync children rows
      const finalIds = new Set(gridRows.map((r) => r.id).filter(Boolean));
      const deletedIds = initialChildIds.filter((id) => !finalIds.has(id));

      // 1. Delete removed rows
      for (const id of deletedIds) {
        await api.deleteRecord(id);
      }

      // 2. Insert or update rows
      for (const row of gridRows) {
        const payload = {
          bangmau: ma,
          stt: row.stt ? Number(row.stt) : 0,
          mact: row.mact || "",
          quytrinh: row.quytrinh || "",
          dinhluong: parseNumber(row.dinhluong),
          somat: parseNumber(row.somat),
          ghichu: row.ghichu || "",
          nguyenlieu: row.nguyenlieu || "",
        };

        if (row.id) {
          await api.updateRecord(row.id, payload);
        } else {
          await api.createRecord(ENTITY_QUYTRINH, payload);
        }
      }

      toast.success(
        modalMode === "add"
          ? "Đã thêm bảng màu mới thành công!"
          : "Đã cập nhật bảng màu thành công!",
      );
      setIsModalOpen(false);

      // Refresh list and select the saved palette
      const res = await api.getRecords(ENTITY_BANGMAU, { limit: 1000 });
      const mapped = res.rows.map((r: { id: string; data: Record<string, unknown> }) => ({
        id: r.id,
        ma: String(r.data.ma ?? ""),
        ten: String(r.data.ten ?? ""),
        hehang: r.data.hehang ? String(r.data.hehang) : null,
        ghichu: r.data.ghichu ? String(r.data.ghichu) : null,
        active: r.data.active !== false,
      }));
      mapped.sort((a, b) => a.ma.localeCompare(b.ma, "vi"));
      setPalettes(mapped);

      const savedPalette = mapped.find((p) => p.ma === ma);
      if (savedPalette) setSelectedPalette(savedPalette);
    } catch (e) {
      toast.error(`Lỗi khi lưu bảng màu: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Export palette list to Excel
  const handleExportExcel = async () => {
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");

      const cols = [
        { header: "Mã", key: "ma" },
        { header: "Tên bảng màu", key: "ten" },
        { header: "Hệ hàng sử dụng", key: "hehang" },
        { header: "Ghi chú", key: "ghichu" },
      ];

      const headerRow = cols.map((c) => ({
        type: String,
        value: c.header,
        fontWeight: "bold" as const,
        align: "left" as const,
        backgroundColor: "#f4f4f5",
      }));

      const bodyRows = filteredPalettes.map((p) =>
        cols.map((c) => {
          const v = p[c.key as keyof PaletteRow];
          return {
            type: String,
            value: v ? String(v) : "",
          };
        }),
      );

      // biome-ignore lint/suspicious/noExplicitAny: library dynamic type
      await writeXlsxFile([headerRow, ...bodyRows] as any, {
        columns: [{ width: 15 }, { width: 30 }, { width: 25 }, { width: 35 }],
      }).toFile("Danh_sach_bang_mau_UV.xlsx");

      toast.success("Xuất Excel danh sách bảng màu thành công!");
    } catch (e) {
      toast.error(`Lỗi xuất Excel: ${(e as Error).message}`);
    }
  };

  // Add a row to the modal grid
  const handleAddGridRow = () => {
    const nextStt = gridRows.length > 0 ? Math.max(...gridRows.map((r) => r.stt)) + 1 : 1;
    setGridRows([
      ...gridRows,
      {
        key: safeRandomUUID(),
        stt: nextStt,
        mact: "",
        tensp: "",
        quytrinh: "",
        dinhluong: 0,
        somat: 0,
        ghichu: "",
        nguyenlieu: "",
      },
    ]);
  };

  // Remove a row from the modal grid
  const handleRemoveGridRow = (index: number) => {
    const newRows = [...gridRows];
    newRows.splice(index, 1);
    // Re-index STT sequentially
    const reindexed = newRows.map((r, i) => ({ ...r, stt: i + 1 }));
    setGridRows(reindexed);
    if (activeLookupIndex === index) {
      setActiveLookupIndex(null);
    } else if (activeLookupIndex !== null && activeLookupIndex > index) {
      setActiveLookupIndex(activeLookupIndex - 1);
    }
  };

  // Filter palettes by search query
  const filteredPalettes = palettes.filter((p) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return p.ma.toLowerCase().includes(query) || p.ten.toLowerCase().includes(query);
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-text">
      {/* Top Banner / Breadcrumb */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <I.Layers className="text-accent" size={18} />
          <h1 className="text-sm font-semibold">QUẢN LÝ BẢNG MÀU UV</h1>
        </div>
      </div>

      {/* Main split pane */}
      <SplitPane
        storageKey="split-bangmau"
        defaultLeftWidth={360}
        minLeft={250}
        minRight={450}
        left={
          <div className="flex flex-1 flex-col h-full overflow-hidden bg-panel/30 border-r border-border">
            {/* Sidebar actions & search */}
            <div className="p-3 border-b border-border space-y-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Danh sách bảng màu
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    onClick={handleExportExcel}
                    className="h-7 px-2 text-xs flex items-center gap-1 border border-border hover:bg-hover rounded text-text font-medium"
                    title="Xuất Excel danh sách bảng màu"
                  >
                    <I.Download size={13} />
                    Xuất
                  </Button>
                </div>
              </div>
              <div className="relative">
                <I.Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                  size={13}
                />
                <input
                  type="text"
                  placeholder="Tìm mã hoặc tên màu…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input w-full h-8 text-xs bg-bg text-text border border-border rounded focus:ring-1 focus:ring-accent focus:border-accent outline-none"
                  style={{ paddingLeft: "32px" }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  >
                    <I.X size={12} />
                  </button>
                )}
              </div>

              {/* Embedded Actions (Hành động nhúng) */}
              {embeddedActions.length > 0 ? (
                <div className="flex items-center gap-1.5 pt-1 border-t border-border/40 flex-wrap shrink-0">
                  {embeddedActions.map((item) => (
                    <ActionWidget key={item.id} config={item} pageState={pageState} inline />
                  ))}
                </div>
              ) : (
                (canCreate || canEdit || canDelete) && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
                    {canCreate && (
                      <Button
                        variant="primary"
                        onClick={handleAddPalette}
                        className="h-7 px-2.5 text-xs flex items-center gap-1 bg-accent hover:bg-accent-2 transition-colors text-white font-medium rounded"
                        title="Thêm mới bảng màu"
                      >
                        <I.Plus size={13} />
                        Thêm
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        disabled={!selectedPalette}
                        onClick={() => selectedPalette && void handleEditPalette(selectedPalette)}
                        className="h-7 px-2.5 text-xs flex items-center gap-1 border border-border hover:bg-hover rounded text-text font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Sửa bảng màu đang chọn"
                      >
                        <I.Edit size={13} />
                        Sửa
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        disabled={!selectedPalette}
                        onClick={() => selectedPalette && void handleDeletePalette(selectedPalette)}
                        className="h-7 px-2.5 text-xs flex items-center gap-1 border border-danger/20 hover:bg-danger/10 text-danger rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Xóa bảng màu đang chọn"
                      >
                        <I.Trash size={13} />
                        Xóa
                      </Button>
                    )}
                  </div>
                )
              )}
            </div>

            {/* List */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {loadingPalettes ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="loader" />
                  <span className="text-xs text-muted mt-3">Đang tải danh sách bảng màu…</span>
                </div>
              ) : (
                <DataGrid
                  data={filteredPalettes}
                  columns={columnsPalettes}
                  toolbar={false}
                  onRowClick={(row) => handleSelectPalette(row)}
                  isRowSelected={(row) => selectedPalette?.id === row.id}
                  emptyText="Không tìm thấy bảng màu nào."
                />
              )}
            </div>
          </div>
        }
        right={
          <div className="flex flex-1 flex-col h-full overflow-hidden bg-bg">
            {selectedPalette ? (
              <div className="flex flex-1 flex-col h-full overflow-hidden p-4 space-y-4">
                {/* Palette Info Card */}
                <div className="card bg-panel border border-border rounded-lg p-4 shadow-sm shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold text-accent">{selectedPalette.ma}</h2>
                      <div className="h-4 w-px bg-border" />
                      <span className="text-base font-semibold text-text">
                        {selectedPalette.ten}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted pt-1">
                      {selectedPalette.hehang && (
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-text">Hệ hàng:</span>
                          <span>{selectedPalette.hehang}</span>
                        </div>
                      )}
                      {selectedPalette.ghichu && (
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-text">Ghi chú:</span>
                          <span>{selectedPalette.ghichu}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Child Grid table panel */}
                <div className="flex-1 flex flex-col overflow-hidden bg-panel/30 border border-border rounded-lg">
                  {loadingQuytrinh ? (
                    <div className="flex flex-col items-center justify-center py-20 h-full">
                      <div className="loader" />
                      <span className="text-xs text-muted mt-3">Đang tải quy trình lăn UV…</span>
                    </div>
                  ) : (
                    <DataGrid
                      data={quytrinhRows}
                      columns={columnsQuytrinh}
                      toolbar={true}
                      label="Quy trình lăn UV"
                      emptyText="Bảng màu này chưa cấu hình các bước quy trình lăn sơn UV."
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-panel/10">
                <EmptyState
                  title="Chọn bảng màu"
                  hint="Hãy chọn một bảng màu UV ở danh sách bên trái để xem chi tiết thông tin và quy trình lăn sơn UV."
                  icon={<I.Layers size={32} className="text-muted/30 animate-pulse" />}
                />
              </div>
            )}
          </div>
        }
      />

      {/* CUSTOM EDIT/ADD MODAL (Screenshot match) */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalMode === "add" ? "Thêm bảng màu mới" : "Cập nhật bảng màu"}
        width={960}
        footer={
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="h-9 px-4 text-xs font-semibold border border-border hover:bg-hover transition-colors rounded text-muted hover:text-text"
            >
              Thoát
            </button>
            <Button
              variant="primary"
              disabled={saving}
              onClick={handleSave}
              className="h-9 px-5 text-xs font-semibold bg-accent hover:bg-accent-2 transition-colors text-white rounded disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-2 text-xs">
          {/* Parent Form Fields */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 bg-panel-2 border border-border/60 p-4 rounded-lg">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Mã bảng màu <span className="text-danger">(*)</span>:
              </label>
              <input
                type="text"
                placeholder="VD: DUV001"
                value={formMa}
                onChange={(e) => setFormMa(e.target.value)}
                disabled={modalMode === "edit"}
                className={`input w-full text-xs font-mono bg-bg text-text border border-border rounded px-3 py-2 outline-none focus:ring-1 focus:ring-accent focus:border-accent ${
                  modalMode === "edit" ? "opacity-60 bg-panel-2 cursor-not-allowed" : ""
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-text mb-1">Hệ hàng sử dụng:</label>
              <TagBox
                className="w-full text-xs"
                value={formHehang}
                onChange={setFormHehang}
                suggestions={hehangs}
                placeholder="Chọn các hệ hàng…"
                pickerTitle="Chọn hệ hàng sử dụng"
                disableDropdown={true}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Tên bảng màu <span className="text-danger">(*)</span>:
              </label>
              <input
                type="text"
                placeholder="Nhập tên bảng màu…"
                value={formTen}
                onChange={(e) => setFormTen(e.target.value)}
                className="input w-full text-xs bg-bg text-text border border-border rounded px-3 py-2 outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-text mb-1">Ghi chú:</label>
              <input
                type="text"
                placeholder="Ghi chú bảng màu…"
                value={formGhichu}
                onChange={(e) => setFormGhichu(e.target.value)}
                className="input w-full text-xs bg-bg text-text border border-border rounded px-3 py-2 outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              />
            </div>
          </div>

          {/* Child Process Grid Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-border pb-1.5">
              <span className="text-xs font-bold text-text uppercase tracking-wider">
                Chi tiết quy trình sơn
              </span>
              <button
                type="button"
                onClick={handleAddGridRow}
                className="h-7 px-3 text-xs font-semibold flex items-center gap-1 bg-panel border border-border hover:bg-hover rounded text-text transition-colors"
              >
                <I.Plus size={13} className="text-accent" />
                Thêm dòng quy trình
              </button>
            </div>

            <div className="overflow-x-auto border border-border rounded-lg h-[280px] relative">
              <table className="w-full text-xs text-left border-collapse border border-border">
                <thead className="bg-panel sticky top-0 z-20 border-b border-border text-muted">
                  <tr>
                    <th className="p-2 border border-border font-semibold text-center w-10">STT</th>
                    <th className="p-2 border border-border font-semibold text-left min-w-[150px]">
                      Tên quy trình
                    </th>
                    <th className="p-2 border border-border font-semibold text-left w-48">
                      Mã chi tiết
                    </th>
                    <th className="p-2 border border-border font-semibold text-left min-w-[200px]">
                      Tên chi tiết
                    </th>
                    <th className="p-2 border border-border font-semibold text-right w-28">
                      Định lượng (gram)
                    </th>
                    <th className="p-2 border border-border font-semibold text-center w-28">
                      Số lớp cán / mặt
                    </th>
                    <th className="p-2 border border-border font-semibold text-left w-36">
                      Ghi chú
                    </th>
                    <th className="p-2 border border-border font-semibold text-center w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {gridRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        style={{ height: "220px" }}
                        className="text-center text-muted border border-border"
                      >
                        Chưa có dòng quy trình nào. Hãy nhấn "Thêm dòng quy trình" để bắt đầu.
                      </td>
                    </tr>
                  ) : (
                    gridRows.map((row, idx) => (
                      <tr key={row.key} className="hover:bg-hover/10 transition-colors">
                        {/* STT */}
                        <td className="p-1 border border-border/80 text-center font-mono font-medium">
                          <input
                            type="number"
                            value={row.stt}
                            onChange={(e) => {
                              const updated = [...gridRows];
                              const item = updated[idx];
                              if (item) item.stt = Number(e.target.value);
                              setGridRows(updated);
                            }}
                            className="w-10 text-center bg-transparent border-0 font-semibold focus:ring-0 focus:outline-none"
                          />
                        </td>

                        {/* Tên quy trình */}
                        <td className="p-1 border border-border/80">
                          <input
                            type="text"
                            placeholder="Nhập quy trình…"
                            value={row.quytrinh}
                            onChange={(e) => {
                              const updated = [...gridRows];
                              const item = updated[idx];
                              if (item) item.quytrinh = e.target.value;
                              setGridRows(updated);
                            }}
                            className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none text-xs"
                          />
                        </td>

                        {/* Mã chi tiết (Lookup Selection field) */}
                        <td className="p-1 border border-border/80 relative">
                          <div
                            ref={activeLookupIndex === idx ? lookupAnchorRef : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeLookupIndex === idx) {
                                setActiveLookupIndex(null);
                              } else {
                                setActiveLookupIndex(idx);
                                setLookupSearch(row.mact);
                                setLookupProducts([]);
                                void searchLookupProducts(row.mact);
                              }
                            }}
                            className="flex items-center justify-start border border-border/80 rounded bg-bg px-2 py-1 cursor-pointer text-left hover:border-accent transition-colors select-none font-mono text-accent min-h-[26px]"
                          >
                            <span>
                              {row.mact || (
                                <span className="text-muted-foreground/30 font-sans">
                                  [Chọn mã chi tiết]
                                </span>
                              )}
                            </span>
                          </div>

                          {/* INLINE LOOKUP PANEL RENDERED VIA PORTAL TO PREVENT CLIPPING */}
                          {activeLookupIndex === idx &&
                            lookupPos &&
                            createPortal(
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "fixed",
                                  ...(lookupPos.top !== undefined
                                    ? { top: lookupPos.top }
                                    : { bottom: lookupPos.bottom }),
                                  left: lookupPos.left,
                                  width: "540px",
                                }}
                                className="z-[1000] bg-panel border border-border shadow-2xl rounded-lg p-3 space-y-2"
                              >
                                <div className="flex gap-2">
                                  <input
                                    ref={lookupInputRef}
                                    type="text"
                                    placeholder="Tìm theo mã sản phẩm hoặc tên sản phẩm…"
                                    value={lookupSearch}
                                    onChange={(e) => setLookupSearch(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        void searchLookupProducts(lookupSearch);
                                    }}
                                    className="input flex-1 h-8 text-xs bg-bg text-text border border-border rounded px-2.5 outline-none focus:ring-1 focus:ring-accent"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void searchLookupProducts(lookupSearch)}
                                    className="h-8 w-8 flex items-center justify-center bg-panel border border-border hover:bg-hover rounded transition-colors shrink-0"
                                    title="Tìm kiếm"
                                  >
                                    <I.Search size={14} className="text-accent" />
                                  </button>
                                </div>

                                <div className="border border-border/80 rounded-md overflow-hidden h-[220px] overflow-y-auto">
                                  <table className="w-full text-xs text-left border-collapse">
                                    <thead className="bg-panel-2 text-muted border-b border-border/60 sticky top-0 z-10">
                                      <tr>
                                        <th className="p-2 font-medium w-40">Mã chi tiết</th>
                                        <th className="p-2 font-medium">Tên chi tiết</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 bg-bg">
                                      {searchingProducts ? (
                                        <tr>
                                          <td colSpan={2} className="p-4 text-center text-muted">
                                            Đang tìm kiếm sản phẩm…
                                          </td>
                                        </tr>
                                      ) : lookupProducts.length === 0 ? (
                                        <tr>
                                          <td colSpan={2} className="p-4 text-center text-muted">
                                            Nhập từ khóa và click tìm kiếm để tìm sản phẩm
                                          </td>
                                        </tr>
                                      ) : (
                                        lookupProducts.map((p) => (
                                          <tr
                                            key={p.masp}
                                            onClick={() => {
                                              const updated = [...gridRows];
                                              const item = updated[idx];
                                              if (item) {
                                                item.mact = p.masp;
                                                item.tensp = p.tensp ?? "";
                                              }
                                              setGridRows(updated);
                                              setActiveLookupIndex(null);
                                            }}
                                            className="hover:bg-hover cursor-pointer transition-colors"
                                          >
                                            <td className="p-2 font-mono font-semibold text-accent">
                                              {p.masp}
                                            </td>
                                            <td className="p-2 text-text truncate max-w-[320px]">
                                              {p.tensp ?? "—"}
                                            </td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="flex justify-end gap-2 pt-1">
                                  {row.mact && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = [...gridRows];
                                        const item = updated[idx];
                                        if (item) {
                                          item.mact = "";
                                          item.tensp = "";
                                        }
                                        setGridRows(updated);
                                        setActiveLookupIndex(null);
                                      }}
                                      className="h-7 px-3 text-xs font-semibold bg-panel border border-border hover:bg-hover rounded text-danger hover:text-danger hover:border-danger/30 transition-colors"
                                    >
                                      Xóa chọn
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveLookupIndex(null);
                                    }}
                                    className="h-7 px-4 text-xs font-semibold bg-panel border border-border hover:bg-hover rounded text-muted hover:text-text transition-colors"
                                  >
                                    Đóng
                                  </button>
                                </div>
                              </div>,
                              document.body,
                            )}
                        </td>

                        {/* Tên chi tiết (Resolved name) */}
                        <td
                          className="p-1 border border-border/80 text-text font-medium truncate max-w-[200px]"
                          title={row.tensp}
                        >
                          {row.tensp || ""}
                        </td>

                        {/* Định lượng */}
                        <td className="p-1 border border-border/80 text-right">
                          <input
                            type="number"
                            placeholder="0"
                            value={getInputValue(row.dinhluong)}
                            onChange={(e) => {
                              const updated = [...gridRows];
                              const v = e.target.value;
                              const item = updated[idx];
                              if (item) {
                                item.dinhluong = v === "" ? null : Number(v);
                              }
                              setGridRows(updated);
                            }}
                            className="w-full text-right bg-transparent border-0 focus:ring-0 focus:outline-none text-xs font-medium"
                          />
                        </td>

                        {/* Số mặt */}
                        <td className="p-1 border border-border/80 text-center">
                          <input
                            type="number"
                            placeholder="0"
                            value={getInputValue(row.somat)}
                            onChange={(e) => {
                              const updated = [...gridRows];
                              const v = e.target.value;
                              const item = updated[idx];
                              if (item) {
                                item.somat = v === "" ? null : Number(v);
                              }
                              setGridRows(updated);
                            }}
                            className="w-full text-center bg-transparent border-0 focus:ring-0 focus:outline-none text-xs"
                          />
                        </td>

                        {/* Ghi chú */}
                        <td className="p-1 border border-border/80">
                          <input
                            type="text"
                            placeholder="Ghi chú bước quy trình…"
                            value={row.ghichu}
                            onChange={(e) => {
                              const updated = [...gridRows];
                              const item = updated[idx];
                              if (item) item.ghichu = e.target.value;
                              setGridRows(updated);
                            }}
                            className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none text-xs text-muted"
                          />
                        </td>

                        {/* Remove Action Button */}
                        <td className="p-1 border border-border/80 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveGridRow(idx)}
                            className="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/20 transition-all"
                          >
                            <I.Trash size={12} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
