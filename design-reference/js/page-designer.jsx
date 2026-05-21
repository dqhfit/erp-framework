/* Page Designer — 12-col drag-drop grid, palette, inspector */

const PAGE_COMPONENTS = [
  { type: 'kpi',    name: 'KPI',     icon: 'TrendUp',   w: 3, h: 2 },
  { type: 'chart',  name: 'Chart',   icon: 'BarChart',  w: 6, h: 4 },
  { type: 'table',  name: 'Table',   icon: 'Table',     w: 12, h: 5 },
  { type: 'list',   name: 'List',    icon: 'List',      w: 4, h: 5 },
  { type: 'kanban', name: 'Kanban',  icon: 'Kanban',    w: 12, h: 6 },
  { type: 'form',   name: 'Form',    icon: 'Edit',      w: 6, h: 5 },
  { type: 'text',   name: 'Text',    icon: 'Type',      w: 6, h: 1 },
  { type: 'filter', name: 'Filter',  icon: 'Filter',    w: 12, h: 1 },
];

const SAMPLE_LAYOUT = {
  p_dashboard: [
    { id: 'a', type: 'text',   x: 0, y: 0, w: 12, h: 1, props: { text: 'Tổng quan kinh doanh tháng 5/2026' } },
    { id: 'b', type: 'kpi',    x: 0, y: 1, w: 3, h: 2,  props: { label: 'Doanh thu', value: '1,82 tỷ', delta: '+12%' } },
    { id: 'c', type: 'kpi',    x: 3, y: 1, w: 3, h: 2,  props: { label: 'Đơn hàng', value: '142', delta: '+8%' } },
    { id: 'd', type: 'kpi',    x: 6, y: 1, w: 3, h: 2,  props: { label: 'KH mới', value: '38', delta: '+22%' } },
    { id: 'e', type: 'kpi',    x: 9, y: 1, w: 3, h: 2,  props: { label: 'Tồn kho', value: '4.2k SKU', delta: '−3%', neg: true } },
    { id: 'f', type: 'chart',  x: 0, y: 3, w: 8, h: 4,  props: { label: 'Doanh thu theo tuần' } },
    { id: 'g', type: 'list',   x: 8, y: 3, w: 4, h: 4,  props: { label: 'Đơn cần duyệt' } },
    { id: 'h', type: 'table',  x: 0, y: 7, w: 12, h: 5, props: { label: 'Đơn hàng gần đây' } },
  ],
  p_orders: [
    { id: 'a', type: 'filter', x: 0, y: 0, w: 12, h: 1, props: {} },
    { id: 'b', type: 'table',  x: 0, y: 1, w: 12, h: 8, props: { label: 'Đơn hàng' } },
  ],
  p_customers: [
    { id: 'a', type: 'kpi',   x: 0, y: 0, w: 4, h: 2, props: { label: 'Tổng KH', value: '1,204', delta: '+34' } },
    { id: 'b', type: 'kpi',   x: 4, y: 0, w: 4, h: 2, props: { label: 'KH VIP', value: '86', delta: '+5' } },
    { id: 'c', type: 'kpi',   x: 8, y: 0, w: 4, h: 2, props: { label: 'Lifetime', value: '78tr', delta: '+12%' } },
    { id: 'd', type: 'list',  x: 0, y: 2, w: 4, h: 6, props: { label: 'KH mới' } },
    { id: 'e', type: 'chart', x: 4, y: 2, w: 8, h: 6, props: { label: 'Phân khúc khách hàng' } },
  ],
  p_inventory: [
    { id: 'a', type: 'kanban', x: 0, y: 0, w: 12, h: 8, props: { label: 'Phiếu nhập / xuất kho' } },
  ],
};

const COLS = 12;
const ROW_H = 56; // px per row

const PageDesigner = ({ pageId, mode, inspectorVisible }) => {
  const initial = PAGES.find((p) => p.id === pageId) || PAGES[0];
  const toast = useToast();

  const [page, setPage] = useState(initial);
  const [items, setItems] = useState(SAMPLE_LAYOUT[initial.id] || []);
  const [selected, setSelected] = useState(null);
  const [device, setDevice] = useState('desktop'); // desktop | tablet | mobile
  const [dragType, setDragType] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);

  useEffect(() => {
    const p = PAGES.find((x) => x.id === pageId) || PAGES[0];
    setPage(p);
    setItems(SAMPLE_LAYOUT[p.id] || []);
    setSelected(null);
  }, [pageId]);

  const canvasRef = useRef(null);

  const addAt = (type, x, y) => {
    const spec = PAGE_COMPONENTS.find((c) => c.type === type);
    const id = 'n_' + Math.random().toString(36).slice(2, 7);
    const cx = Math.max(0, Math.min(COLS - spec.w, x));
    setItems((it) => [...it, { id, type, x: cx, y, w: spec.w, h: spec.h, props: {} }]);
    setSelected(id);
    toast.success(`Đã thêm ${spec.name}`);
  };

  const updateItem = (id, patch) => setItems((it) => it.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const deleteItem = (id) => {
    setItems((it) => it.filter((x) => x.id !== id));
    if (selected === id) setSelected(null);
  };

  const handleCanvasDrop = (e) => {
    if (!dragType || !canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const colW = rect.width / COLS;
    const x = Math.floor((e.clientX - rect.left) / colW);
    const y = Math.floor((e.clientY - rect.top) / ROW_H);
    addAt(dragType, x, y);
    setDragType(null); setDragOverCell(null);
  };

  const selectedItem = items.find((i) => i.id === selected);
  const PageIcon = I[page.icon] || I.Layout;

  const deviceWidth = device === 'mobile' ? 420 : device === 'tablet' ? 820 : null;

  return (
    <div className="flex flex-col h-full" data-screen-label={`Page · ${page.name}`}>
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="w-7 h-7 rounded-md bg-accent-2/15 text-accent-2 flex items-center justify-center">
          <PageIcon size={14} />
        </div>
        <InlineEdit value={page.name} onChange={(v) => setPage({ ...page, name: v })}
          className="font-semibold text-base" />
        <span className="chip" style={{ height: 20 }}>{items.length} components</span>

        <div className="flex-1"></div>

        <div className="mode-toggle mr-2">
          {['desktop', 'tablet', 'mobile'].map((d) => (
            <button key={d} className={device === d ? 'on' : ''} onClick={() => setDevice(d)}>
              {d === 'desktop' ? 'Desktop' : d === 'tablet' ? 'Tablet' : 'Mobile'}
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />}>Undo</Button>
        <div className="w-px h-5 bg-border mx-1"></div>
        <Button variant="default" size="sm" icon={<I.Eye size={13} />}>Preview</Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />}>Lưu (⌘S)</Button>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-auto min-w-0">
        {/* Palette */}
        {mode === 'designer' && (
          <div className="w-[220px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Components</div>
              <div className="text-xs text-muted mt-0.5">Kéo vào canvas →</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {PAGE_COMPONENTS.map((c) => {
                const IC = I[c.icon];
                return (
                  <div
                    key={c.type}
                    draggable
                    onDragStart={() => setDragType(c.type)}
                    onDragEnd={() => { setDragType(null); setDragOverCell(null); }}
                    className={`flex items-center gap-2.5 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 hover:bg-hover/40 cursor-grab active:cursor-grabbing
                      ${dragType === c.type ? 'dragging' : ''}`}
                  >
                    <div className="w-7 h-7 rounded bg-panel-2 border border-border flex items-center justify-center text-muted">
                      <IC size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[10px] text-muted">{c.w}×{c.h} cells</div>
                    </div>
                    <I.Grip size={12} className="text-muted" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-auto canvas-dots p-6 flex justify-center">
          <div
            ref={canvasRef}
            onDragOver={(e) => {
              if (!dragType || !canvasRef.current) return;
              e.preventDefault();
              const rect = canvasRef.current.getBoundingClientRect();
              const colW = rect.width / COLS;
              setDragOverCell({
                x: Math.floor((e.clientX - rect.left) / colW),
                y: Math.floor((e.clientY - rect.top) / ROW_H),
              });
            }}
            onDragLeave={() => setDragOverCell(null)}
            onDrop={handleCanvasDrop}
            onClick={(e) => { if (e.target === canvasRef.current) setSelected(null); }}
            className="relative bg-panel border border-border rounded-lg shadow-xl"
            style={{
              width: deviceWidth || '100%',
              maxWidth: 1280,
              minHeight: 720,
              backgroundImage: mode === 'designer' ?
                'linear-gradient(hsl(var(--border) / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.25) 1px, transparent 1px)' : 'none',
              backgroundSize: mode === 'designer' ? `calc(100% / 12) ${ROW_H}px` : undefined,
            }}
          >
            {items.map((item) => (
              <PageItem
                key={item.id}
                item={item}
                active={selected === item.id}
                mode={mode}
                rowH={ROW_H}
                onSelect={() => setSelected(item.id)}
                onUpdate={(p) => updateItem(item.id, p)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
            {/* drag preview ghost */}
            {dragType && dragOverCell && (() => {
              const spec = PAGE_COMPONENTS.find((c) => c.type === dragType);
              return (
                <div
                  className="absolute drop-zone-active rounded-md pointer-events-none"
                  style={{
                    left: `${(dragOverCell.x / COLS) * 100}%`,
                    top: dragOverCell.y * ROW_H,
                    width: `${(spec.w / COLS) * 100}%`,
                    height: spec.h * ROW_H,
                  }}
                ></div>
              );
            })()}
            {items.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-muted text-sm">
                  <I.Layout size={24} className="mx-auto mb-2 opacity-60" />
                  Canvas trống — kéo component từ palette vào đây
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inspector */}
        {mode === 'designer' && inspectorVisible && (
          <PageInspector item={selectedItem} onUpdate={(p) => selectedItem && updateItem(selectedItem.id, p)}
                         onDelete={() => selectedItem && deleteItem(selectedItem.id)} />
        )}
      </div>
    </div>
  );
};

const PageItem = ({ item, active, mode, rowH, onSelect, onUpdate, onDelete }) => {
  const style = {
    left: `${(item.x / COLS) * 100}%`,
    top: item.y * rowH,
    width: `${(item.w / COLS) * 100}%`,
    height: item.h * rowH - 6,
    padding: 3,
  };

  const handleResize = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const parent = e.currentTarget.parentElement.parentElement;
    const rect = parent.getBoundingClientRect();
    const colW = rect.width / COLS;
    const startX = e.clientX, startY = e.clientY;
    const startW = item.w, startH = item.h;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const dw = Math.round(dx / colW), dh = Math.round(dy / rowH);
      const w = Math.max(1, Math.min(COLS - item.x, startW + dw));
      const h = Math.max(1, startH + dh);
      onUpdate({ w, h });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`absolute ${mode === 'designer' ? 'cursor-pointer' : ''}`}
      style={style}
    >
      <div className={`relative w-full h-full rounded-md bg-panel-2/70 border transition-colors overflow-hidden
        ${active && mode === 'designer' ? 'border-accent shadow-[0_0_0_2px_hsl(var(--accent)/0.3)]' : 'border-border hover:border-hover'}`}>
        <PageItemContent item={item} />
        {active && mode === 'designer' && (
          <>
            <div className="resize-handle" onMouseDown={handleResize}></div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="absolute top-1 right-1 w-6 h-6 rounded bg-bg-soft border border-border flex items-center justify-center text-muted hover:text-danger" title="Delete">
              <I.Trash size={11} />
            </button>
          </>
        )}
        {mode === 'designer' && (
          <div className="absolute top-1 left-1 chip" style={{ height: 18, fontSize: 10 }}>{item.type}</div>
        )}
      </div>
    </div>
  );
};

const PageItemContent = ({ item }) => {
  const p = item.props || {};
  switch (item.type) {
    case 'text':
      return (
        <div className="p-3 flex items-center h-full">
          <div className="text-base font-semibold">{p.text || 'Heading'}</div>
        </div>
      );
    case 'kpi':
      return (
        <div className="p-3 h-full flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted">{p.label || 'KPI'}</div>
            <div className={`text-xs font-semibold ${p.neg ? 'text-danger' : 'text-success'}`}>{p.delta || '+0%'}</div>
          </div>
          <div className="text-2xl font-semibold leading-none">{p.value || '0'}</div>
        </div>
      );
    case 'chart':
      return (
        <div className="p-3 h-full flex flex-col">
          <div className="text-xs text-muted mb-1">{p.label || 'Chart'}</div>
          <MiniChart />
        </div>
      );
    case 'table':
      return (
        <div className="h-full flex flex-col">
          <div className="px-3 py-2 border-b border-border text-xs text-muted flex items-center justify-between">
            <span>{p.label || 'Bảng dữ liệu'}</span>
            <span>{ORDER_ROWS.length} dòng</span>
          </div>
          <MiniTable />
        </div>
      );
    case 'list':
      return (
        <div className="h-full flex flex-col">
          <div className="px-3 py-2 border-b border-border text-xs text-muted">{p.label || 'List'}</div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {ORDER_ROWS.slice(0, 4).map((r) => (
              <div key={r.id} className="px-3 py-2 text-sm hover:bg-hover/30">
                <div className="font-mono text-xs text-muted">{r.id}</div>
                <div className="truncate">{r.customer}</div>
                <div className="text-xs text-accent">{formatVND(r.total)}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case 'kanban':
      return (
        <div className="h-full p-2 grid grid-cols-4 gap-2 overflow-hidden">
          {['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Đã giao'].map((col, idx) => (
            <div key={col} className="bg-bg-soft border border-border rounded-md p-2 flex flex-col gap-1.5 min-h-0">
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>{col}</span>
                <span className="chip" style={{ height: 16, fontSize: 10 }}>{[3,5,2,4][idx]}</span>
              </div>
              {ORDER_ROWS.slice(idx, idx + 2).map((r) => (
                <div key={r.id} className="bg-panel border border-border rounded p-2 text-xs">
                  <div className="font-mono text-muted">{r.id}</div>
                  <div className="truncate">{r.customer}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    case 'form':
      return (
        <div className="p-3 space-y-2">
          <div className="text-xs text-muted">Form</div>
          <div className="space-y-2">
            <div className="skeleton h-8"></div>
            <div className="skeleton h-8"></div>
            <div className="skeleton h-16"></div>
          </div>
        </div>
      );
    case 'filter':
      return (
        <div className="px-3 h-full flex items-center gap-2">
          <I.Filter size={12} className="text-muted" />
          <span className="chip chip-accent">Trạng thái: Tất cả</span>
          <span className="chip">Ngày: 30 ngày</span>
          <span className="chip">+ Filter</span>
        </div>
      );
    default:
      return null;
  }
};

// Tiny SVG chart placeholder
const MiniChart = () => {
  const data = [40, 65, 50, 78, 90, 72, 88, 95, 110, 102, 130, 118];
  const max = Math.max(...data);
  return (
    <svg viewBox="0 0 240 100" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.45" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="url(#g)"
        stroke="hsl(var(--accent))" strokeWidth="1.5"
        points={
          data.map((v, i) => `${(i / (data.length - 1)) * 240},${100 - (v / max) * 90}`).join(' ')
          + ` 240,100 0,100`
        }
      />
      <polyline
        fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5"
        points={data.map((v, i) => `${(i / (data.length - 1)) * 240},${100 - (v / max) * 90}`).join(' ')}
      />
      {data.map((v, i) => (
        <circle key={i} cx={(i / (data.length - 1)) * 240} cy={100 - (v / max) * 90} r="1.5" fill="hsl(var(--accent))" />
      ))}
    </svg>
  );
};

const MiniTable = () => (
  <div className="flex-1 overflow-y-auto text-sm">
    <table className="w-full">
      <thead className="bg-bg-soft text-xs text-muted">
        <tr>
          <th className="text-left font-medium px-3 py-2">Mã đơn</th>
          <th className="text-left font-medium px-3 py-2">Khách hàng</th>
          <th className="text-right font-medium px-3 py-2">Tổng tiền</th>
          <th className="text-left font-medium px-3 py-2">Trạng thái</th>
          <th className="text-left font-medium px-3 py-2">Ngày</th>
        </tr>
      </thead>
      <tbody>
        {ORDER_ROWS.map((r) => (
          <tr key={r.id} className="border-t border-border hover:bg-hover/30">
            <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
            <td className="px-3 py-2 truncate">{r.customer}</td>
            <td className="px-3 py-2 text-right font-mono text-xs">{formatVND(r.total)}</td>
            <td className="px-3 py-2">
              <span className={`chip ${
                r.status === 'Chờ duyệt' ? 'chip-warning' :
                r.status === 'Đã duyệt' ? 'chip-accent' :
                r.status === 'Đã giao' ? 'chip-success' :
                r.status === 'Huỷ' ? 'chip-danger' : ''
              }`}>{r.status}</span>
            </td>
            <td className="px-3 py-2 text-xs text-muted">{r.date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const PageInspector = ({ item, onUpdate, onDelete }) => {
  const [tab, setTab] = useState('data');
  if (!item) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">
          Inspector
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
          Chọn component trên canvas để chỉnh sửa.
        </div>
      </aside>
    );
  }
  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border">
        <div className="text-sm font-semibold capitalize">{item.type} component</div>
        <button onClick={onDelete} className="w-7 h-7 rounded hover:bg-danger/15 text-muted hover:text-danger flex items-center justify-center">
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'data', label: 'Data' }, { value: 'style', label: 'Style' }, { value: 'events', label: 'Events' }
      ]} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'data' && (
          <>
            <FormField label="Bind to entity">
              <select className="input" defaultValue="order">
                {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </FormField>
            <FormField label="Label">
              <input className="input" value={item.props?.label || ''}
                     onChange={(e) => onUpdate({ props: { ...item.props, label: e.target.value } })} />
            </FormField>
            {item.type === 'kpi' && (
              <>
                <FormField label="Value">
                  <input className="input" value={item.props?.value || ''}
                         onChange={(e) => onUpdate({ props: { ...item.props, value: e.target.value } })} />
                </FormField>
                <FormField label="Delta">
                  <input className="input" value={item.props?.delta || ''}
                         onChange={(e) => onUpdate({ props: { ...item.props, delta: e.target.value } })} />
                </FormField>
              </>
            )}
            <FormField label="Filter">
              <input className="input" placeholder="status = 'Chờ duyệt'" />
            </FormField>
          </>
        )}
        {tab === 'style' && (
          <>
            <FormField label="Position (x, y)">
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="number" value={item.x} onChange={(e) => onUpdate({ x: +e.target.value })} />
                <input className="input" type="number" value={item.y} onChange={(e) => onUpdate({ y: +e.target.value })} />
              </div>
            </FormField>
            <FormField label="Size (w × h)">
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="number" value={item.w} onChange={(e) => onUpdate({ w: +e.target.value })} />
                <input className="input" type="number" value={item.h} onChange={(e) => onUpdate({ h: +e.target.value })} />
              </div>
            </FormField>
            <FormField label="Background">
              <div className="grid grid-cols-4 gap-1">
                {['transparent', 'panel-2', 'accent/15', 'success/15'].map((b) => (
                  <button key={b} className="h-8 rounded border border-border bg-bg-soft hover:border-accent text-xs">{b}</button>
                ))}
              </div>
            </FormField>
          </>
        )}
        {tab === 'events' && (
          <>
            <FormField label="onClick">
              <select className="input">
                <option>— none —</option>
                <option>Open detail drawer</option>
                <option>Run workflow…</option>
                <option>Navigate to…</option>
              </select>
            </FormField>
          </>
        )}
      </div>
    </aside>
  );
};

Object.assign(window, { PageDesigner, PageItemContent });
