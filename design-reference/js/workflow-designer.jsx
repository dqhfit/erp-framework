/* Workflow Designer — ReactFlow-style canvas with nodes + edges */

const NODE_TYPES = [
  { type: 'trigger',   name: 'Trigger',   icon: 'Zap',         color: 'accent-2', desc: 'Bắt đầu workflow' },
  { type: 'action',    name: 'Action',    icon: 'Play',        color: 'accent',   desc: 'Gọi MCP tool' },
  { type: 'condition', name: 'Condition', icon: 'GitBranch',   color: 'warning',  desc: 'Rẽ nhánh if/else' },
  { type: 'loop',      name: 'Loop',      icon: 'Redo',        color: 'accent-2', desc: 'Lặp qua list' },
  { type: 'agent',     name: 'Agent',     icon: 'Bot',         color: 'accent',   desc: 'Gọi AI agent' },
  { type: 'approval',  name: 'Approval',  icon: 'CheckSq',     color: 'success',  desc: 'Chờ phê duyệt' },
  { type: 'delay',     name: 'Delay',     icon: 'Clock',       color: 'muted',    desc: 'Chờ N phút/giờ' },
  { type: 'email',     name: 'Email',     icon: 'Mail',        color: 'accent-2', desc: 'Gửi email' },
];

const SAMPLE_NODES = {
  w_approve_big_order: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 60,  y: 80,  label: 'Đơn hàng được tạo', sub: 'order.created' },
      { id: 'n2', type: 'condition', x: 320, y: 80,  label: 'Tổng tiền > 50tr?', sub: 'order.total > 50_000_000' },
      { id: 'n3', type: 'approval', x: 600, y: 30,  label: 'Chờ Sếp duyệt', sub: 'role: manager' },
      { id: 'n4', type: 'action', x: 600, y: 180, label: 'Auto-approve', sub: 'order.update(status=approved)' },
      { id: 'n5', type: 'email', x: 880, y: 100, label: 'Gửi email xác nhận', sub: 'template: order_confirmed' },
      { id: 'n6', type: 'agent', x: 880, y: 220, label: 'Agent ghi log', sub: 'log_to_crm' },
    ],
    edges: [
      { from: 'n1', to: 'n2', port: 'next' },
      { from: 'n2', to: 'n3', port: 'true', label: 'Có' },
      { from: 'n2', to: 'n4', port: 'false', label: 'Không' },
      { from: 'n3', to: 'n5', port: 'approved' },
      { from: 'n4', to: 'n6', port: 'next' },
    ],
  },
  w_onboarding: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 60, y: 80, label: 'Nhân viên mới', sub: 'employee.created' },
      { id: 'n2', type: 'action',  x: 320, y: 80, label: 'Tạo tài khoản', sub: 'auth.create_user' },
      { id: 'n3', type: 'email',   x: 580, y: 80, label: 'Welcome email', sub: 'template: welcome' },
      { id: 'n4', type: 'delay',   x: 840, y: 80, label: 'Chờ 1 ngày', sub: '1d' },
      { id: 'n5', type: 'agent',   x: 1100, y: 80, label: 'Check-in agent', sub: 'first_day_buddy' },
    ],
    edges: [
      { from: 'n1', to: 'n2', port: 'next' },
      { from: 'n2', to: 'n3', port: 'next' },
      { from: 'n3', to: 'n4', port: 'next' },
      { from: 'n4', to: 'n5', port: 'next' },
    ],
  },
  w_low_stock: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 60, y: 80, label: 'Cron mỗi 30 phút', sub: 'schedule: */30 * * * *' },
      { id: 'n2', type: 'action',  x: 320, y: 80, label: 'Query SKU low', sub: 'inv.product.list(stock<10)' },
      { id: 'n3', type: 'condition', x: 580, y: 80, label: 'Có SKU nào?', sub: 'count > 0' },
      { id: 'n4', type: 'agent',   x: 840, y: 30, label: 'Soạn báo cáo', sub: 'summarize_low_stock' },
      { id: 'n5', type: 'email',   x: 1100, y: 30, label: 'Gửi quản lý kho', sub: 'kho@cty.vn' },
    ],
    edges: [
      { from: 'n1', to: 'n2', port: 'next' },
      { from: 'n2', to: 'n3', port: 'next' },
      { from: 'n3', to: 'n4', port: 'true', label: 'Có' },
      { from: 'n4', to: 'n5', port: 'next' },
    ],
  },
};

const NODE_W = 200;
const NODE_H = 76;

const WorkflowDesigner = ({ workflowId, mode, inspectorVisible }) => {
  const initial = WORKFLOWS.find((w) => w.id === workflowId) || WORKFLOWS[0];
  const toast = useToast();

  const [wf, setWf] = useState(initial);
  const sample = SAMPLE_NODES[initial.id] || { nodes: [], edges: [] };
  const [nodes, setNodes] = useState(sample.nodes);
  const [edges, setEdges] = useState(sample.edges);
  const [selected, setSelected] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragType, setDragType] = useState(null);
  const [connecting, setConnecting] = useState(null); // { fromId, port, x, y }
  const [tab, setTab] = useState('config');
  const [showRun, setShowRun] = useState(false);

  useEffect(() => {
    const w = WORKFLOWS.find((x) => x.id === workflowId) || WORKFLOWS[0];
    setWf(w);
    const s = SAMPLE_NODES[w.id] || { nodes: [], edges: [] };
    setNodes(s.nodes); setEdges(s.edges);
    setSelected(null);
  }, [workflowId]);

  const canvasRef = useRef(null);

  const addNode = (type, x, y) => {
    const spec = NODE_TYPES.find((n) => n.type === type);
    const id = 'n_' + Math.random().toString(36).slice(2, 7);
    setNodes((ns) => [...ns, {
      id, type, x: x - NODE_W / 2, y: y - NODE_H / 2,
      label: spec.name, sub: spec.desc,
    }]);
    setSelected(id);
    toast.success(`Đã thêm node ${spec.name}`);
  };

  const onCanvasDrop = (e) => {
    if (!dragType || !canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    addNode(dragType, e.clientX - rect.left, e.clientY - rect.top);
    setDragType(null);
  };

  const startNodeDrag = (id, e) => {
    e.stopPropagation();
    if (mode !== 'designer') return;
    const node = nodes.find((n) => n.id === id);
    const startX = e.clientX, startY = e.clientY;
    const origX = node.x, origY = node.y;
    setSelected(id);
    setDraggingNode(id);
    const move = (ev) => {
      setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) } : n));
    };
    const up = () => {
      setDraggingNode(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startConnect = (fromId, port, e) => {
    e.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    setConnecting({ fromId, port, x: e.clientX - rect.left, y: e.clientY - rect.top });
    const move = (ev) => {
      const r = canvasRef.current.getBoundingClientRect();
      setConnecting((c) => c ? { ...c, x: ev.clientX - r.left, y: ev.clientY - r.top } : c);
    };
    const up = (ev) => {
      // Was hovering over a node?
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
      const nodeEl = tgt?.closest('[data-node-id]');
      if (nodeEl) {
        const toId = nodeEl.getAttribute('data-node-id');
        if (toId !== fromId) {
          setEdges((es) => [...es, { from: fromId, to: toId, port }]);
          toast.success('Đã nối node');
        }
      }
      setConnecting(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const deleteNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  };

  // Simulated test run
  const [runLog, setRunLog] = useState([]);
  const [activeStep, setActiveStep] = useState(null);
  const runTest = () => {
    setShowRun(true);
    setRunLog([]);
    setActiveStep(null);
    // BFS-ish through edges from any trigger
    const trig = nodes.find((n) => n.type === 'trigger');
    if (!trig) return;
    let cur = trig.id;
    const path = [];
    const visited = new Set();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      path.push(cur);
      const out = edges.find((e) => e.from === cur);
      cur = out?.to;
    }
    path.forEach((nid, idx) => {
      setTimeout(() => {
        setActiveStep(nid);
        const node = nodes.find((n) => n.id === nid);
        setRunLog((l) => [...l, {
          time: new Date().toLocaleTimeString('vi-VN'),
          node: node.label,
          type: node.type,
          status: 'ok',
          msg: idx === 0 ? 'Trigger nhận event' : `Hoàn tất ${node.type}`,
        }]);
      }, idx * 500);
    });
    setTimeout(() => setActiveStep(null), path.length * 500 + 400);
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const WfIcon = I[wf.icon] || I.Workflow;

  return (
    <div className="flex flex-col h-full" data-screen-label={`Workflow · ${wf.name}`}>
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="w-7 h-7 rounded-md bg-success/15 text-success flex items-center justify-center">
          <WfIcon size={14} />
        </div>
        <InlineEdit value={wf.name} onChange={(v) => setWf({ ...wf, name: v })} className="font-semibold text-base" />
        <span className={`chip ${wf.status === 'active' ? 'chip-success' : 'chip-warning'}`}>
          {wf.status === 'active' ? '● Active' : '⏸ Paused'}
        </span>
        <span className="text-xs text-muted">{wf.runs} runs / 30d</span>

        <div className="flex-1"></div>

        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />}>Undo</Button>
        <Button variant="ghost" size="sm" icon={<I.Redo size={13} />} />
        <div className="w-px h-5 bg-border mx-1"></div>
        <Button variant="default" size="sm" icon={<I.Play size={13} />} onClick={runTest}>Test run</Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />}>Lưu (⌘S)</Button>
      </div>

      <div className="flex-1 flex overflow-auto min-w-0">
        {/* Palette */}
        {mode === 'designer' && (
          <div className="w-[200px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Node types</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {NODE_TYPES.map((n) => {
                const IC = I[n.icon];
                return (
                  <div key={n.type}
                       draggable
                       onDragStart={() => setDragType(n.type)}
                       onDragEnd={() => setDragType(null)}
                       className="flex items-center gap-2 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 cursor-grab">
                    <div className={`w-6 h-6 rounded flex items-center justify-center
                      ${n.color === 'accent' ? 'bg-accent/15 text-accent' :
                        n.color === 'accent-2' ? 'bg-accent-2/15 text-accent-2' :
                        n.color === 'success' ? 'bg-success/15 text-success' :
                        n.color === 'warning' ? 'bg-warning/15 text-warning' :
                        'bg-panel-2 text-muted'}`}>
                      <IC size={11} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold">{n.name}</div>
                      <div className="text-[10px] text-muted line-clamp-2">{n.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            ref={canvasRef}
            className="flex-1 canvas-grid relative overflow-auto"
            onDragOver={(e) => dragType && e.preventDefault()}
            onDrop={onCanvasDrop}
            onClick={() => setSelected(null)}
          >
            <div className="absolute inset-0 min-w-[1400px] min-h-[700px]">
              {/* Edges layer */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0 0 L10 5 L0 10 z" fill="hsl(var(--accent))" />
                  </marker>
                </defs>
                {edges.map((e, i) => {
                  const from = nodes.find((n) => n.id === e.from);
                  const to = nodes.find((n) => n.id === e.to);
                  if (!from || !to) return null;
                  const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
                  const x2 = to.x, y2 = to.y + NODE_H / 2;
                  const dx = Math.abs(x2 - x1) * 0.5;
                  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                  return (
                    <g key={i}>
                      <path d={path} className="wf-edge" markerEnd="url(#arrow)" />
                      {e.label && (
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle"
                              fontSize="10" fill="hsl(var(--muted))"
                              className="font-mono">{e.label}</text>
                      )}
                    </g>
                  );
                })}
                {connecting && (() => {
                  const from = nodes.find((n) => n.id === connecting.fromId);
                  if (!from) return null;
                  const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
                  return <path d={`M ${x1} ${y1} L ${connecting.x} ${connecting.y}`} className="wf-edge-temp" />;
                })()}
              </svg>

              {/* Nodes */}
              {nodes.map((n) => (
                <WfNode
                  key={n.id}
                  node={n}
                  active={selected === n.id}
                  running={activeStep === n.id}
                  mode={mode}
                  onMouseDown={(e) => startNodeDrag(n.id, e)}
                  onSelect={() => setSelected(n.id)}
                  onDelete={() => deleteNode(n.id)}
                  onStartConnect={(port, e) => startConnect(n.id, port, e)}
                />
              ))}

              {nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-muted text-sm pointer-events-none">
                  Kéo node từ palette vào canvas
                </div>
              )}
            </div>

            {/* Floating zoom */}
            <div className="absolute bottom-3 left-3 panel rounded-md flex items-center text-xs">
              <button className="px-2 h-7 hover:bg-hover/40"><I.Minus size={11} /></button>
              <span className="px-2 text-muted">100%</span>
              <button className="px-2 h-7 hover:bg-hover/40"><I.Plus size={11} /></button>
            </div>
          </div>

          {/* Test run drawer */}
          {showRun && (
            <div className="border-t border-border bg-panel h-[180px] flex flex-col">
              <div className="h-9 px-3 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <I.Play size={12} className="text-success" /> Test run log
                </div>
                <button onClick={() => setShowRun(false)} className="text-muted hover:text-text">
                  <I.X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
                {runLog.length === 0 ? (
                  <div className="text-muted px-2 py-1">Đang chạy…</div>
                ) : runLog.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-0.5 hover:bg-hover/30 rounded">
                    <span className="text-muted">{l.time}</span>
                    <span className="text-success">✓</span>
                    <span className="text-accent">[{l.type}]</span>
                    <span className="flex-1">{l.node} — {l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {mode === 'designer' && inspectorVisible && (
          <WfInspector
            node={selectedNode}
            onUpdate={(p) => selectedNode && setNodes((ns) => ns.map((n) => n.id === selectedNode.id ? { ...n, ...p } : n))}
            onDelete={() => selectedNode && deleteNode(selectedNode.id)}
            tab={tab} setTab={setTab}
          />
        )}
      </div>
    </div>
  );
};

const WfNode = ({ node, active, running, mode, onMouseDown, onSelect, onDelete, onStartConnect }) => {
  const spec = NODE_TYPES.find((n) => n.type === node.type) || NODE_TYPES[0];
  const IC = I[spec.icon];
  const color = spec.color;
  return (
    <div
      data-node-id={node.id}
      onMouseDown={onMouseDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`absolute panel rounded-lg border-2 transition-all select-none group
        ${active ? 'border-accent shadow-[0_0_0_3px_hsl(var(--accent)/0.25)]' : 'border-border hover:border-hover'}
        ${running ? 'shadow-[0_0_0_3px_hsl(var(--success)/0.5)] border-success animate-pulse' : ''}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, cursor: mode === 'designer' ? 'grab' : 'default' }}
    >
      <div className="flex items-center gap-2 p-2 h-full">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0
          ${color === 'accent' ? 'bg-accent/15 text-accent' :
            color === 'accent-2' ? 'bg-accent-2/15 text-accent-2' :
            color === 'success' ? 'bg-success/15 text-success' :
            color === 'warning' ? 'bg-warning/15 text-warning' :
            'bg-panel-2 text-muted'}`}>
          <IC size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">{spec.name}</div>
          <div className="text-sm font-medium truncate leading-tight">{node.label}</div>
          <div className="text-[10px] font-mono text-muted truncate">{node.sub}</div>
        </div>
      </div>

      {/* Input port */}
      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-bg border-2 border-accent"></div>

      {/* Output port(s) */}
      {node.type === 'condition' ? (
        <>
          <div className="absolute -right-1.5 top-[18px] w-3 h-3 rounded-full bg-bg border-2 border-success cursor-crosshair"
               onMouseDown={(e) => onStartConnect?.('true', e)} title="True" />
          <div className="absolute -right-1.5 bottom-[18px] w-3 h-3 rounded-full bg-bg border-2 border-danger cursor-crosshair"
               onMouseDown={(e) => onStartConnect?.('false', e)} title="False" />
        </>
      ) : (
        <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-bg border-2 border-accent cursor-crosshair"
             onMouseDown={(e) => onStartConnect?.('next', e)} title="Next" />
      )}

      {active && mode === 'designer' && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-md">
          <I.X size={10} />
        </button>
      )}
    </div>
  );
};

const WfInspector = ({ node, onUpdate, onDelete, tab, setTab }) => {
  if (!node) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">
          Inspector
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
          Chọn node để chỉnh sửa. Kéo từ output port để nối.
        </div>
      </aside>
    );
  }
  const spec = NODE_TYPES.find((n) => n.type === node.type);
  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border">
        <div className="text-sm font-semibold">{spec.name} · <span className="font-mono text-xs text-muted">{node.id}</span></div>
        <button onClick={onDelete} className="w-7 h-7 rounded hover:bg-danger/15 text-muted hover:text-danger flex items-center justify-center">
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'config', label: 'Config' }, { value: 'data', label: 'Data' }, { value: 'logs', label: 'Logs' }
      ]} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'config' && (
          <>
            <FormField label="Label">
              <input className="input" value={node.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
            {node.type === 'action' && (
              <>
                <FormField label="MCP tool">
                  <select className="input">
                    <option>sales.order.update</option>
                    <option>crm.customer.create</option>
                    <option>inv.product.list</option>
                  </select>
                </FormField>
                <FormField label="Input mapping" hint="Map từ context vào tham số tool.">
                  <textarea className="input font-mono" rows={4}
                            defaultValue={'{\n  "id": "{{order.id}}",\n  "status": "approved"\n}'} />
                </FormField>
              </>
            )}
            {node.type === 'condition' && (
              <FormField label="Expression">
                <textarea className="input font-mono" rows={2} defaultValue={node.sub} />
              </FormField>
            )}
            {node.type === 'agent' && (
              <>
                <FormField label="LLM Profile">
                  <select className="input"><option>Sonnet 4 (default)</option><option>Haiku 4.5</option></select>
                </FormField>
                <FormField label="System prompt">
                  <textarea className="input" rows={4}
                            defaultValue="Bạn là trợ lý cho phòng kho. Hãy giúp tóm tắt danh sách SKU tồn thấp." />
                </FormField>
                <FormField label="Tools (MCP)">
                  <div className="flex flex-wrap gap-1">
                    <span className="chip chip-accent">inv.product.list</span>
                    <span className="chip chip-accent">notif.send</span>
                    <span className="chip">+ Add</span>
                  </div>
                </FormField>
              </>
            )}
            {node.type === 'delay' && (
              <FormField label="Duration">
                <div className="flex gap-2">
                  <input className="input" type="number" defaultValue="1" />
                  <select className="input"><option>phút</option><option>giờ</option><option>ngày</option></select>
                </div>
              </FormField>
            )}
            {node.type === 'approval' && (
              <>
                <FormField label="Người duyệt">
                  <select className="input"><option>Role: Giám đốc</option><option>User: Sếp Hùng</option></select>
                </FormField>
                <FormField label="SLA"><input className="input" defaultValue="24 giờ" /></FormField>
              </>
            )}
          </>
        )}
        {tab === 'data' && (
          <>
            <FormField label="Input schema">
              <pre className="input font-mono text-[11px] overflow-x-auto" style={{ height: 'auto', padding: 10 }}>
{`{
  order: Order,
  user: User,
}`}
              </pre>
            </FormField>
            <FormField label="Output">
              <pre className="input font-mono text-[11px]" style={{ height: 'auto', padding: 10 }}>
{`{
  ok: boolean,
  result: any,
}`}
              </pre>
            </FormField>
          </>
        )}
        {tab === 'logs' && (
          <div className="space-y-2 font-mono text-xs">
            <div className="p-2 bg-bg-soft rounded border border-border">
              <div className="text-success">✓ 14:32:01 OK</div>
              <div className="text-muted">Duration: 142ms</div>
            </div>
            <div className="p-2 bg-bg-soft rounded border border-border">
              <div className="text-success">✓ 14:31:48 OK</div>
              <div className="text-muted">Duration: 98ms</div>
            </div>
            <div className="p-2 bg-bg-soft rounded border border-border">
              <div className="text-danger">✗ 14:30:22 FAIL</div>
              <div className="text-muted">Timeout after 30s</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

Object.assign(window, { WorkflowDesigner });
