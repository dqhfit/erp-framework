import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button, Card } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useEntities } from "@/stores/entities";

export const Route = createFileRoute("/entities/")({
  component: function EntitiesIndex() {
    const entities = useEntities((s) => s.entities);
    const add = useEntities((s) => s.add);
    const remove = useEntities((s) => s.remove);
    const navigate = useNavigate();

    const handleCreate = () => {
      const e = add({ name: `entity_${entities.length + 1}`, label: "Entity mới" });
      navigate({ to: "/entities/$id", params: { id: e.id } });
    };

    return (
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Entities</h1>
          <Button variant="primary" onClick={handleCreate}>
            + Entity mới
          </Button>
        </div>
        {entities.length === 0 ? (
          <Card className="text-center text-muted py-12">
            Chưa có entity. Bấm <b>+ Entity mới</b> để bắt đầu.
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {entities.map((e) => (
              <Card key={e.id} className="hover:border-accent transition">
                <div className="flex justify-between items-start">
                  <div>
                    <Link
                      to="/entities/$id"
                      params={{ id: e.id }}
                      className="font-bold hover:text-accent2"
                    >
                      {e.label}
                    </Link>
                    <div className="text-xs text-muted font-mono mt-1">{e.name}</div>
                    <div className="text-xs text-muted mt-1">{e.fields.length} fields</div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      if (
                        await dialog.confirm(`Xóa entity "${e.label || e.name}"?`, {
                          title: "Xóa entity",
                          confirmText: "Xóa",
                          danger: true,
                        })
                      )
                        remove(e.id);
                    }}
                  >
                    ×
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  },
});
