/* ==========================================================
   page-state-sources.ts — Tổng hợp danh sách "nguồn state"
   mà các widget trên page emit ra pageState. Inspector dùng
   để render dropdown "Master" / "Source" cho filter binding.
   Pure helper, không phụ thuộc React.
   ========================================================== */
import type { MockEntity } from "@/lib/object-types";

export type StateValueType = "scalar" | "array" | "object";

export interface StateSource {
  /** Component nguồn (để filter ra widget hiện hành). */
  componentId: string;
  /** Loại widget — để hiển thị icon + group trong picker. */
  componentKind: string;
  /** Nhãn hiển thị cho user (vd "Combobox: Trạng thái"). */
  label: string;
  /** Key thực trong pageState. */
  stateKey: string;
  /** Kiểu giá trị emit — gợi ý operator phù hợp. */
  valueType: StateValueType;
  /** entityId nếu source bind 1 entity cụ thể (Form/Detail field…) */
  entityId?: string;
  /** Tên field gốc nếu source là 1 field của entity. */
  fieldName?: string;
}

interface PageComponentLike {
  id: string;
  kind: string;
  config: Record<string, unknown>;
}

/** Truncate string for label display. */
function clip(s: string, max = 30): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Lấy title hiển thị từ config widget — fallback "list1"/"combobox2" theo id. */
function widgetTitle(comp: PageComponentLike, entities: MockEntity[]): string {
  const cfgTitle = comp.config.title as string | undefined;
  if (cfgTitle) return clip(cfgTitle);
  const cfgLabel = comp.config.label as string | undefined;
  if (cfgLabel && comp.kind !== "kpi") return clip(cfgLabel);
  const entId = comp.config.entity as string | undefined;
  if (entId) {
    const ent = entities.find((e) => e.id === entId);
    if (ent) return clip(ent.name);
  }
  return comp.id;
}

/**
 * Thu thập mọi nguồn state các widget khác đang emit.
 * @param components Toàn bộ widget trên page.
 * @param currentId Component đang được edit — loại trừ khỏi danh sách (không tự bind chính mình).
 * @param entities Danh sách entity để giải nghĩa fields cho Form/Detail emit.
 */
export function collectStateSources(
  components: PageComponentLike[],
  currentId: string,
  entities: MockEntity[],
): StateSource[] {
  const out: StateSource[] = [];

  for (const c of components) {
    if (c.id === currentId) continue;
    const title = widgetTitle(c, entities);

    if (c.kind === "list") {
      const selKey = (c.config.selectionStateKey as string) || `sel_${c.id}`;
      out.push({
        componentId: c.id,
        componentKind: c.kind,
        label: `Row của ${title}`,
        stateKey: selKey,
        valueType: "scalar",
        entityId: c.config.entity as string | undefined,
      });
    } else if (c.kind === "combobox" || c.kind === "search") {
      const sk = c.config.stateKey as string | undefined;
      if (!sk) continue;
      out.push({
        componentId: c.id,
        componentKind: c.kind,
        label: `${c.kind === "search" ? "Search" : "Combobox"}: ${title}`,
        stateKey: sk,
        valueType: "scalar",
      });
    } else if (c.kind === "listbox") {
      const sk = c.config.stateKey as string | undefined;
      if (!sk) continue;
      const multi = c.config.multiSelect !== false;
      out.push({
        componentId: c.id,
        componentKind: c.kind,
        label: `Listbox: ${title}${multi ? " (nhiều)" : ""}`,
        stateKey: sk,
        valueType: multi ? "array" : "scalar",
      });
    } else if (c.kind === "tagbox") {
      const sk = c.config.stateKey as string | undefined;
      if (!sk) continue;
      out.push({
        componentId: c.id,
        componentKind: c.kind,
        label: `Tagbox: ${title}`,
        stateKey: sk,
        valueType: "array",
      });
    } else if (c.kind === "form" && c.config.emitLiveFields === true) {
      // Mỗi field bound entity emit ra form:<id>:<fieldName>
      const entId = c.config.entity as string | undefined;
      const ent = entId ? entities.find((e) => e.id === entId) : null;
      if (!ent) continue;
      for (const f of ent.fields ?? []) {
        out.push({
          componentId: c.id,
          componentKind: c.kind,
          label: `Form ${title} · ${f.label}`,
          stateKey: `form:${c.id}:${f.name}`,
          valueType: f.type === "multi-lookup" ? "array" : "scalar",
          entityId: entId,
          fieldName: f.name,
        });
      }
    } else if (c.kind === "detail" && c.config.recordIdFromState) {
      // Detail emit mỗi field ra detail:<id>:<fieldName> khi load
      const entId = c.config.entity as string | undefined;
      const ent = entId ? entities.find((e) => e.id === entId) : null;
      if (!ent) continue;
      for (const f of ent.fields ?? []) {
        out.push({
          componentId: c.id,
          componentKind: c.kind,
          label: `Detail ${title} · ${f.label}`,
          stateKey: `detail:${c.id}:${f.name}`,
          valueType: f.type === "multi-lookup" ? "array" : "scalar",
          entityId: entId,
          fieldName: f.name,
        });
      }
    } else if (c.kind === "action" || c.kind === "actionbar") {
      // Action / Actionbar: mỗi step procedure có saveOutputTo → emit ra stateKey đó.
      const items =
        c.kind === "actionbar"
          ? ((c.config.items as Array<Record<string, unknown>> | undefined) ?? [])
          : [c.config];
      for (const item of items) {
        const steps = (item.steps as Array<Record<string, unknown>> | undefined) ?? [];
        for (const s of steps) {
          if (s.kind === "procedure" && typeof s.saveOutputTo === "string" && s.saveOutputTo) {
            const procName = (s.procedureName as string) || "procedure";
            out.push({
              componentId: c.id,
              componentKind: c.kind,
              label: `Action ${title} · ${procName}`,
              stateKey: s.saveOutputTo,
              valueType: "object",
            });
          }
        }
      }
    }
  }

  // Dedup theo stateKey (Form/Action có thể trùng nếu user đặt cùng key).
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.stateKey)) return false;
    seen.add(s.stateKey);
    return true;
  });
}

/** Nhóm sources theo loại để render trong dropdown picker. */
export function groupSources(sources: StateSource[]): Array<{
  label: string;
  items: StateSource[];
}> {
  const groups: Record<string, StateSource[]> = {};
  const order = ["list", "combobox", "search", "listbox", "tagbox", "form", "detail", "action"];
  const labels: Record<string, string> = {
    list: "Row selection (List)",
    combobox: "Combobox",
    search: "Search",
    listbox: "Listbox",
    tagbox: "Tagbox",
    form: "Form (live)",
    detail: "Detail (record)",
    action: "Action output",
    actionbar: "Action output",
  };
  for (const s of sources) {
    const k = s.componentKind === "actionbar" ? "action" : s.componentKind;
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  }
  const result: Array<{ label: string; items: StateSource[] }> = [];
  for (const k of order) {
    const items = groups[k];
    if (items && items.length > 0) {
      result.push({ label: labels[k] ?? k, items });
    }
  }
  return result;
}
