/* Command palette (Cmd+K) */

const CommandPalette = ({ open, onClose, onRun }) => {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQ(''); setIdx(0); }}, [open]);

  const items = useMemo(() => {
    const all = [
      { kind: 'nav', name: 'Workspace', icon: 'Home', go: () => onRun({ kind: 'home' }), section: 'Đi đến' },
      ...ENTITIES.map((e) => ({ kind: 'entity', name: e.name, icon: e.icon, sub: e.mcp, go: () => onRun({ kind: 'entity', id: e.id }), section: 'Entities' })),
      ...PAGES.map((p) => ({ kind: 'page', name: p.name, icon: p.icon, sub: 'Page', go: () => onRun({ kind: 'page', id: p.id }), section: 'Pages' })),
      ...WORKFLOWS.map((w) => ({ kind: 'workflow', name: w.name, icon: w.icon, sub: 'Workflow', go: () => onRun({ kind: 'workflow', id: w.id }), section: 'Workflows' })),
      { kind: 'action', name: 'Tạo Entity mới', icon: 'Plus', kbd: 'N E', go: () => onRun({ kind: 'entity', id: 'customer' }), section: 'Actions' },
      { kind: 'action', name: 'Tạo Page mới', icon: 'Plus', kbd: 'N P', go: () => onRun({ kind: 'page', id: 'p_dashboard' }), section: 'Actions' },
      { kind: 'action', name: 'Tạo Workflow mới', icon: 'Plus', kbd: 'N W', go: () => onRun({ kind: 'workflow', id: 'w_approve_big_order' }), section: 'Actions' },
      { kind: 'action', name: 'Mở Trợ lý ERP', icon: 'Sparkles', kbd: '⌘ /', go: () => onRun({ kind: '__agent__' }), section: 'Actions' },
      { kind: 'action', name: 'Sếp Mode (Mobile Dashboard)', icon: 'Phone', go: () => onRun({ kind: '__mobile__' }), section: 'Actions' },
      { kind: 'nav', name: 'LLM Profiles', icon: 'Sparkles', go: () => onRun({ kind: 'settings-llm' }), section: 'Settings' },
      { kind: 'nav', name: 'MCP Server', icon: 'Server', go: () => onRun({ kind: 'settings-mcp' }), section: 'Settings' },
    ];
    if (!q.trim()) return all;
    const qq = q.toLowerCase();
    return all.filter((i) => i.name.toLowerCase().includes(qq) || (i.sub || '').toLowerCase().includes(qq));
  }, [q]);

  useEffect(() => { setIdx(0); }, [q]);

  // Group by section
  const grouped = useMemo(() => {
    const m = new Map();
    items.forEach((it) => {
      if (!m.has(it.section)) m.set(it.section, []);
      m.get(it.section).push(it);
    });
    return [...m.entries()];
  }, [items]);

  const flat = items;

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[950] flex items-start justify-center pt-[12vh] p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
      <div className="relative panel rounded-lg shadow-2xl w-full max-w-[640px] overflow-hidden flex flex-col"
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 h-12 border-b border-border">
          <I.Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); flat[idx]?.go(); onClose(); }
              if (e.key === 'Escape') onClose();
            }}
            className="flex-1 bg-transparent outline-none text-base"
            placeholder="Tìm entity, page, workflow, hoặc gõ lệnh…"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {grouped.length === 0 && (
            <div className="px-4 py-8 text-center text-muted text-sm">Không tìm thấy kết quả.</div>
          )}
          {grouped.map(([section, list]) => (
            <div key={section} className="py-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted font-semibold">{section}</div>
              {list.map((it) => {
                const flatIdx = flat.indexOf(it);
                const IC = I[it.icon] || I.Folder;
                const active = flatIdx === idx;
                return (
                  <div
                    key={section + it.name}
                    onMouseEnter={() => setIdx(flatIdx)}
                    onClick={() => { it.go(); onClose(); }}
                    className={`mx-1 px-2.5 h-9 rounded-md flex items-center gap-2.5 cursor-pointer text-sm
                      ${active ? 'bg-accent/15 text-accent' : ''}`}
                  >
                    <IC size={14} className={active ? 'text-accent' : 'text-muted'} />
                    <span className="flex-1 truncate">{it.name}</span>
                    {it.sub && <span className="text-xs text-muted truncate">{it.sub}</span>}
                    {it.kbd && (
                      <span className="flex items-center gap-1">
                        {it.kbd.split(' ').map((k, i) => <span key={i} className="kbd">{k}</span>)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-3 h-8 border-t border-border flex items-center justify-between text-[11px] text-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> điều hướng</span>
            <span className="flex items-center gap-1"><span className="kbd">↵</span> chọn</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="kbd">⌘</span><span className="kbd">K</span>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CommandPalette });
