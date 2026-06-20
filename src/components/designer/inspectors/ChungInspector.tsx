/* Tab "Chung" của inspector PageDesigner: loại + tiêu đề + HTML (widget html) +
   kích thước (w/h) + tràn chiều cao + nhắc gắn nguồn cho widget nhập. Tách từ
   PageDesigner.tsx (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import {
  INPUT_WIDGET_KINDS,
  type PageComponent,
} from "@/components/designer/page-designer-constants";
import { Chip, FormField, Input, Switch, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";

export function ChungInspector({
  sel,
  update,
  setInspTab,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
  setInspTab: (tab: string) => void;
}) {
  const t = useT();
  return (
    <>
      <FormField label={t("designer.comp_type")}>
        <Chip variant="accent">{t(`page.comp.${sel.kind}`)}</Chip>
      </FormField>
      <FormField label={t("designer.comp_title")}>
        <Input
          placeholder={t("designer.comp_title_placeholder")}
          value={(sel.config.title as string) ?? ""}
          onChange={(e) => update(sel.id, { config: { ...sel.config, title: e.target.value } })}
        />
      </FormField>
      {/* Widget HTML / Ghi chú — ô nhập nội dung (trước đây
                          thiếu inspector nên "không ghi chú được"). */}
      {sel.kind === "html" && (
        <FormField
          label="Nội dung HTML / Ghi chú"
          hint="Nhập HTML hoặc ghi chú; hiển thị trong khung sandbox ở trang."
        >
          <Textarea
            className="font-mono"
            rows={8}
            placeholder={"<h3>Ghi chú</h3>\n<p>Nội dung…</p>"}
            value={(sel.config.html as string) ?? ""}
            onChange={(e) => update(sel.id, { config: { ...sel.config, html: e.target.value } })}
          />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-2">
        <FormField label={t("field.width")}>
          <Input
            type="number"
            min="1"
            max="12"
            value={sel.w}
            onChange={(e) =>
              update(sel.id, {
                w: Math.max(1, Math.min(12, Number.parseInt(e.target.value, 10) || 1)),
              })
            }
          />
        </FormField>
        <FormField label={t("designer.comp_height")}>
          <Input
            type="number"
            min="1"
            value={sel.h}
            onChange={(e) =>
              update(sel.id, {
                h: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
              })
            }
          />
        </FormField>
      </div>
      <div className="text-[10px] text-muted/70 leading-relaxed">
        Mẹo: kéo cạnh phải/đáy hoặc góc dưới-phải của widget trên canvas để đổi kích thước (hoặc
        nhập số ô ở trên).
      </div>
      {/* Tràn chiều cao — chỉ hiện cho widget cuộn được */}
      {(["list", "chart", "kanban", "pivot", "table"] as string[]).includes(sel.kind) && (
        <FormField
          label="Tràn chiều cao màn hình"
          hint="Widget lấp hết chiều cao còn lại của viewport. Nếu nhiều widget cùng bật → dùng 'Vừa màn hình' ở cài đặt trang."
        >
          <Switch
            checked={!!sel.config.fillHeight}
            onChange={(v) => update(sel.id, { config: { ...sel.config, fillHeight: v } })}
          />
        </FormField>
      )}
      {INPUT_WIDGET_KINDS.has(sel.kind) && (
        <button
          type="button"
          onClick={() => setInspTab("dieukien")}
          className="w-full text-left text-[11px] px-2 py-1.5 rounded-md border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10"
        >
          → Gắn nguồn dữ liệu (Entity + Field) ở tab "Nguồn &amp; Điều khiển"
        </button>
      )}
    </>
  );
}
