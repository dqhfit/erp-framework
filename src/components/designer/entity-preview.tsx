/* ==========================================================
   entity-preview.tsx — AutoForm preview cho entity (consumer mode).
   Render field theo type → input component tương ứng.
   Tách khỏi EntityDesigner.tsx (P2.7 refactor).
   ========================================================== */
import { I } from "@/components/Icons";
import { Button, FormField, Input, Select, Switch, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";
import type { MockEntity } from "@/lib/object-types";
import { useUserObjects } from "@/stores/userObjects";

export function EntityFormPreview({ entity }: { entity: MockEntity }) {
  const t = useT();
  const userEntities = useUserObjects((s) => s.entities);
  return (
    <div className="max-w-[640px] mx-auto py-8 px-6">
      <div className="text-xs text-muted uppercase tracking-wider mb-2">Preview · AutoForm</div>
      <h2 className="text-xl font-semibold mb-1">{t("entity.create", { name: entity.name })}</h2>
      <p className="text-sm text-muted mb-5">{t("entity.preview_subtitle")}</p>
      <div className="card p-5 space-y-4">
        {entity.fields.length === 0 && (
          <div className="text-muted text-center py-6 text-sm">{t("entity.schema_empty")}</div>
        )}
        {entity.fields.map((f) => (
          <FormField key={f.id} label={f.label + (f.required ? " *" : "")}>
            {f.type === "longtext" ? (
              <Textarea rows={3} />
            ) : f.type === "bool" ? (
              <Switch checked={false} onChange={() => {}} label={t("field.yes_no")} />
            ) : f.type === "select" ? (
              <Select>
                {(f.options ?? ["—"]).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            ) : f.type === "lookup" ? (
              <div className="flex items-center gap-2">
                <Select>
                  <option>
                    — chọn {userEntities.find((e) => e.id === f.ref)?.name ?? "tham chiếu"} —
                  </option>
                </Select>
                <Button variant="default" size="sm" icon={<I.Search size={12} />} />
              </div>
            ) : f.type === "date" || f.type === "datetime" ? (
              <Input type={f.type === "datetime" ? "datetime-local" : "date"} />
            ) : f.type === "currency" ? (
              <div className="relative">
                <Input type="number" placeholder="0" className="pr-12" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                  VND
                </span>
              </div>
            ) : (
              <Input placeholder={f.label} />
            )}
          </FormField>
        ))}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="default">{t("common.cancel")}</Button>
          <Button variant="primary" icon={<I.Save size={13} />}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
