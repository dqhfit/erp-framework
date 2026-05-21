/* Entity Designer — field palette → fields list (DnD) + inspector tabs */

const EntityDesigner = ({ entityId, mode, inspectorVisible, density }) => {
  const initial = ENTITIES.find((e) => e.id === entityId) || ENTITIES[0];
  const toast = useToast();

  // Always sync to entityId
  const [entity, setEntity] = useState(initial);
  useEffect(() => {
    setEntity(ENTITIES.find((e) => e.id === entityId) || ENTITIES[0]);
    setSelected(null);
  }, [entityId]);

  const [selected, setSelected] = useState(null);
  const [insTab, setInsTab] = useState('data'); // data | style | events
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [dragFromPalette, setDragFromPalette] = useState(null);

  // Add a field
  const addField = (type, atIdx) => {
    const ft = FIELD_TYPES.find((f) => f.id === type);
    const id = 'nf_' + Math.random().toString(36).slice(2, 7);
    const newField = {
      id,
      name: `${type}_${entity.fields.length + 1}`,
      label: ft.name,
      type,
      required: false,
    };
    setEntity((e) => {
      const idx = atIdx ?? e.fields.length;
      const fields = [...e.fields];
      fields.splice(idx, 0, newField);
      return { ...e, fields };
    });
    setSelected(id);
    toast.success(`Đã thêm field ${ft.name}`);
  };

  const updateField = (id, patch) => {
    setEntity((e) => ({ ...e, fields: e.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  };

  const deleteField = (id) => {
    setEntity((e) => ({ ...e, fields: e.fields.filter((f) => f.id !== id) }));
    if (selected === id) setSelected(null);
  };

  // Reorder within list
  const reorder = (from, to) => {
    if (from === to) return;
    setEntity((e) => {
      const fields = [...e.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to > from ? to - 1 : to, 0, moved);
      return { ...e, fields };
    });
  };

  const selectedField = entity.fields.find((f) => f.id === selected);

  // Save
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const save = () => {
    setSaving(true);
    setTimeout(() => { setSaving(false); setLastSaved(new Date()); toast.success('Đã lưu schema'); }, 600);
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const IconC = I[entity.icon] || I.Database;

  return (
    <div className="flex flex-col h-full" data-screen-label={`Entity · ${entity.name}`}>
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
            <IconC size={14} />
          </div>
          <div className="flex flex-col leading-tight">
            <InlineEdit value={entity.name} onChange={(v) => setEntity({ ...entity, name: v })}
              className="font-semibold text-base" />
            <div className="text-[11px] text-muted font-mono">{entity.mcp} · {entity.fields.length} fields</div>
          </div>
        </div>
        <span className="text-muted text-xs">/</span>
        <span className="text-xs text-muted">Entity Designer</span>

        <div className="flex-1"></div>

        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />} title="Undo">Undo</Button>
        <Button variant="ghost" size="sm" icon={<I.Redo size={13} />} title="Redo" />
        <div className="w-px h-5 bg-border mx-1"></div>
        <Button variant="ghost" size="sm" icon={<I.Play size={13} />} title="Preview as form">Form</Button>
        <Button variant="default" size="sm" icon={<I.Eye size={13} />}>Preview</Button>
        <Button variant="primary" size="sm" onClick={save}
                icon={saving ? <I.Loader size={13} className="animate-spin" /> : <I.Save size={13} />}>
          {saving ? 'Đang lưu…' : 'Lưu (⌘S)'}
        </Button>

        {lastSaved && !saving && (
          <span className="text-xs text-muted ml-2 flex items-center gap-1">
            <I.Check size={11} className="text-success" /> Đã lưu
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-auto min-w-0">
        {/* Field palette */}
        {mode === 'designer' && (
          <div className="w-[220px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Field types</div>
              <div className="text-xs text-muted mt-0.5">Kéo vào danh sách →</div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 grid grid-cols-2 gap-1.5 content-start">
              {FIELD_TYPES.map((ft) => {
                const IC = I[ft.icon] || I.Type;
                return (
                  <div
                    key={ft.id}
                    draggable
                    onDragStart={(e) => { setDragFromPalette(ft.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onDragEnd={() => { setDragFromPalette(null); setDragOverIdx(null); }}
                    onDoubleClick={() => addField(ft.id)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 hover:bg-hover/40 cursor-grab active:cursor-grabbing
                      ${dragFromPalette === ft.id ? 'dragging' : ''}`}
                    title={`${ft.name} — ${ft.desc} (double-click to add)`}
                  >
                    <IC size={14} className="text-muted" />
                    <div className="text-[11px] font-medium leading-tight text-center">{ft.name}</div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-border text-[11px] text-muted">
              Mẹo: double-click để thêm nhanh
            </div>
          </div>
        )}

        {/* Fields list canvas */}
        <div className="flex-1 overflow-y-auto bg-bg min-w-[480px]">
          {mode === 'consumer' ? (
            <EntityFormPreview entity={entity} />
          ) : (
            <div className="max-w-[760px] mx-auto py-6 px-6">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-lg font-semibold">Schema fields</div>
                  <div className="text-xs text-muted">Sắp xếp, đặt label, validation, lookup ref…</div>
                </div>
                <div className="text-xs text-muted">{entity.fields.length} fields</div>
              </div>

              {entity.fields.length === 0 ? (
                <EmptyState
                  icon={<I.Database size={20} className="text-muted" />}
                  title="Chưa có field nào"
                  hint="Kéo field từ palette bên trái, hoặc double-click loại field để thêm nhanh."
                />
              ) : (
                <div
                  className="card divide-y divide-border overflow-hidden"
                  onDragOver={(e) => { if (dragFromPalette) { e.preventDefault(); }}}
                >
                  {entity.fields.map((f, idx) => (
                    <React.Fragment key={f.id}>
                      {/* Drop zone between rows */}
                      <div
                        onDragOver={(e) => { if (dragFromPalette) { e.preventDefault(); setDragOverIdx(idx); }}}
                        onDragLeave={() => setDragOverIdx((v) => (v === idx ? null : v))}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragFromPalette) { addField(dragFromPalette, idx); setDragFromPalette(null); setDragOverIdx(null); }
                        }}
                        className={`h-2 -my-1 transition-colors ${dragOverIdx === idx && dragFromPalette ? 'drop-zone-active h-6 my-0' : ''}`}
                      ></div>
                      <FieldRow
                        field={f}
                        active={selected === f.id}
                        onSelect={() => setSelected(f.id)}
                        onUpdate={(p) => updateField(f.id, p)}
                        onDelete={() => deleteField(f.id)}
                        onDuplicate={() => addField(f.type, idx + 1)}
                        idx={idx}
                        onReorder={reorder}
                      />
                    </React.Fragment>
                  ))}
                  {/* Final drop zone */}
                  <div
                    onDragOver={(e) => { if (dragFromPalette) { e.preventDefault(); setDragOverIdx(entity.fields.length); }}}
                    onDragLeave={() => setDragOverIdx(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFromPalette) { addField(dragFromPalette); setDragFromPalette(null); setDragOverIdx(null); }
                    }}
                    className={`h-8 flex items-center justify-center text-xs text-muted transition-colors ${
                      dragOverIdx === entity.fields.length && dragFromPalette ? 'drop-zone-active' : ''
                    }`}
                  >
                    {dragFromPalette ? '↓ Thả vào đây để thêm cuối danh sách' : 'Kéo field vào đây hoặc giữa các hàng'}
                  </div>
                </div>
              )}

              {/* MCP bindings */}
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-2">MCP bindings</h3>
                <p className="text-xs text-muted mb-3">Map 5 ops sang tool của MCP server.</p>
                <div className="card">
                  {['list', 'get', 'create', 'update', 'delete'].map((op) => (
                    <div key={op} className="flex items-center gap-3 px-4 h-11 border-b border-border last:border-b-0">
                      <div className="w-20 font-mono text-xs uppercase text-muted">{op}</div>
                      <I.ArrowRight size={12} className="text-muted" />
                      <div className="flex-1 text-sm font-mono">{entity.mcp}.{op}</div>
                      <span className="chip chip-success"><I.Check size={10} /> Connected</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {mode === 'designer' && inspectorVisible && (
          <FieldInspector
            field={selectedField}
            onUpdate={(p) => selectedField && updateField(selectedField.id, p)}
            onDelete={() => selectedField && deleteField(selectedField.id)}
            tab={insTab} setTab={setInsTab}
          />
        )}
      </div>
    </div>
  );
};

const FieldRow = ({ field, active, onSelect, onUpdate, onDelete, onDuplicate, idx, onReorder }) => {
  const ft = FIELD_TYPES.find((f) => f.id === field.type) || FIELD_TYPES[0];
  const IC = I[ft.icon] || I.Type;
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/field-idx', String(idx));
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        const data = e.dataTransfer.types.includes('text/field-idx');
        if (data) { e.preventDefault(); setDragOver(true); }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData('text/field-idx');
        if (from !== '') { onReorder(parseInt(from, 10), idx); }
        setDragOver(false);
      }}
      className={`flex items-center gap-3 px-3 h-12 cursor-pointer group transition-colors
        ${active ? 'bg-accent/10' : 'hover:bg-hover/30'}
        ${dragging ? 'dragging' : ''}
        ${dragOver ? 'drop-zone-active' : ''}`}
    >
      <I.Grip size={14} className="text-muted opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
      <div className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted shrink-0">
        <IC size={13} />
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="font-medium truncate">{field.label}</div>
        <span className="font-mono text-[11px] text-muted truncate">{field.name}</span>
      </div>
      <span className="chip" style={{ height: 20, fontSize: 11 }}>{ft.name}</span>
      {field.required && <span className="chip chip-warning" style={{ height: 20, fontSize: 11 }}>Required</span>}
      {field.type === 'lookup' && field.ref && (
        <span className="chip chip-accent" style={{ height: 20, fontSize: 11 }}>→ {field.ref}</span>
      )}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted" title="Duplicate">
          <I.Copy size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="w-6 h-6 rounded hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger" title="Delete">
          <I.Trash size={12} />
        </button>
      </div>
    </div>
  );
};

const FieldInspector = ({ field, onUpdate, onDelete, tab, setTab }) => {
  if (!field) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">
          Inspector
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
          Chọn một field để chỉnh sửa thuộc tính.
        </div>
      </aside>
    );
  }
  const ft = FIELD_TYPES.find((f) => f.id === field.type) || FIELD_TYPES[0];
  const IC = I[ft.icon] || I.Type;

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-panel-2 border border-border flex items-center justify-center text-muted">
            <IC size={12} />
          </div>
          <div className="text-sm font-semibold truncate">{field.label}</div>
        </div>
        <button onClick={onDelete} className="w-7 h-7 rounded hover:bg-danger/15 text-muted hover:text-danger flex items-center justify-center" title="Delete field">
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs
        value={tab} onChange={setTab}
        options={[
          { value: 'data', label: 'Data' },
          { value: 'style', label: 'Style' },
          { value: 'events', label: 'Events' },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'data' && (
          <>
            <FormField label="Label hiển thị">
              <input className="input" value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
            <FormField label="Tên kỹ thuật (snake_case)" hint="Dùng cho API và biểu thức.">
              <input className="input font-mono" value={field.name} onChange={(e) => onUpdate({ name: e.target.value })} />
            </FormField>
            <FormField label="Loại field">
              <select className="input" value={field.type} onChange={(e) => onUpdate({ type: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">Required</span>
                <Switch checked={!!field.required} onChange={(v) => onUpdate({ required: v })} />
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">Unique</span>
                <Switch checked={!!field.unique} onChange={(v) => onUpdate({ unique: v })} />
              </div>
            </div>

            {field.type === 'select' && (
              <FormField label="Options" hint="Mỗi dòng một giá trị.">
                <textarea
                  className="input font-mono" rows={4}
                  value={(field.options || []).join('\n')}
                  onChange={(e) => onUpdate({ options: e.target.value.split('\n').filter(Boolean) })}
                />
              </FormField>
            )}

            {field.type === 'lookup' && (
              <FormField label="Reference entity">
                <select className="input" value={field.ref || ''} onChange={(e) => onUpdate({ ref: e.target.value })}>
                  <option value="">— chọn entity —</option>
                  {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </FormField>
            )}

            {field.type === 'formula' && (
              <FormField label="Công thức" hint="Vd: {price} * {qty}">
                <input className="input font-mono" placeholder="{price} * {qty}" />
              </FormField>
            )}

            <FormField label="Mô tả">
              <textarea className="input" rows={2} value={field.desc || ''} onChange={(e) => onUpdate({ desc: e.target.value })} placeholder="Hiển thị dưới field ở form" />
            </FormField>
          </>
        )}

        {tab === 'style' && (
          <>
            <FormField label="Width">
              <div className="grid grid-cols-3 gap-1">
                {['1/3', '1/2', 'Full'].map((w) => (
                  <button key={w} onClick={() => onUpdate({ width: w })}
                    className={`btn btn-sm ${field.width === w ? 'btn-primary' : 'btn-default'}`}>{w}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Placeholder">
              <input className="input" value={field.placeholder || ''} onChange={(e) => onUpdate({ placeholder: e.target.value })} />
            </FormField>
            <FormField label="Help text vị trí">
              <select className="input" value={field.hintPos || 'below'}>
                <option value="below">Dưới field</option>
                <option value="tooltip">Trong tooltip</option>
              </select>
            </FormField>
          </>
        )}

        {tab === 'events' && (
          <>
            <FormField label="onChange">
              <textarea className="input font-mono" rows={4}
                placeholder="// JS expression"
                defaultValue={'// vd: chạy workflow validate\nrun("validate_field", { value })'} />
            </FormField>
            <FormField label="onSubmit hook">
              <select className="input"><option>— none —</option><option>w_approve_big_order</option></select>
            </FormField>
          </>
        )}
      </div>
    </aside>
  );
};

const EntityFormPreview = ({ entity }) => (
  <div className="max-w-[640px] mx-auto py-8 px-6">
    <div className="text-xs text-muted uppercase tracking-wider mb-2">Preview · AutoForm</div>
    <h2 className="text-xl font-semibold mb-1">Tạo {entity.name}</h2>
    <p className="text-sm text-muted mb-5">Form tự sinh từ schema. Chế độ này = Consumer Mode.</p>
    <div className="card p-5 space-y-4">
      {entity.fields.length === 0 && (
        <div className="text-muted text-center py-6 text-sm">Schema chưa có field nào.</div>
      )}
      {entity.fields.map((f) => (
        <FormField key={f.id} label={f.label + (f.required ? ' *' : '')}>
          {f.type === 'longtext' ? <textarea className="input" rows={3} placeholder={f.placeholder} /> :
           f.type === 'bool' ? <Switch checked={false} onChange={() => {}} label="Có / Không" /> :
           f.type === 'select' ? (
             <select className="input">{(f.options || ['—']).map((o) => <option key={o}>{o}</option>)}</select>
           ) :
           f.type === 'lookup' ? (
             <div className="flex items-center gap-2">
               <select className="input"><option>— chọn {ENTITIES.find((e) => e.id === f.ref)?.name || 'tham chiếu'} —</option></select>
               <Button variant="default" size="sm" icon={<I.Search size={12} />} />
             </div>
           ) :
           f.type === 'date' || f.type === 'datetime' ? (
             <input type={f.type === 'datetime' ? 'datetime-local' : 'date'} className="input" />
           ) :
           f.type === 'currency' ? (
             <div className="relative">
               <input className="input pr-12" type="number" placeholder="0" />
               <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">VND</span>
             </div>
           ) : (
             <input className="input" placeholder={f.placeholder || ''} />
           )}
        </FormField>
      ))}
      {entity.fields.length > 0 && (
        <div className="pt-3 flex items-center justify-end gap-2">
          <Button variant="ghost">Huỷ</Button>
          <Button variant="primary" icon={<I.Save size={13} />}>Lưu {entity.name}</Button>
        </div>
      )}
    </div>
  </div>
);

Object.assign(window, { EntityDesigner });
