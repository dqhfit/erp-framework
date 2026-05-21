/* Agent Chat Panel — right drawer with simulated typing */

const SUGGESTIONS_FIRST = [
  'Tạo đơn hàng mới',
  'Báo cáo doanh thu tuần này',
  'Tóm tắt 5 đơn chờ duyệt',
  'Mời thêm khách hàng',
];

const SCRIPT = {
  'tạo đơn hàng mới': {
    typing: 1200,
    chunks: [
      { text: 'Để tạo đơn mới, mình cần biết khách hàng và sản phẩm.', delay: 0 },
      { tool: 'crm.customer.list', delay: 600 },
      { text: 'Mình thấy KH gần đây của bạn:', delay: 1100 },
      { card: 'customer-pick', delay: 100 },
    ],
    suggestions: ['Khách mới', 'Bỏ qua, để mình tự nhập'],
  },
  'báo cáo doanh thu tuần này': {
    typing: 1500,
    chunks: [
      { tool: 'sales.order.list', delay: 0 },
      { tool: 'analytics.aggregate', delay: 700 },
      { text: 'Doanh thu tuần 19/5–25/5: **412,8 triệu ₫** (+14% so với tuần trước).', delay: 1300 },
      { card: 'chart', delay: 200 },
      { text: 'Top 3 KH: Minh Phúc (84M), Sao Mai (145M), Hoàng Long (57M). Bạn muốn mình gửi báo cáo cho Sếp Hùng không?', delay: 300 },
    ],
    suggestions: ['Gửi báo cáo qua email', 'Phân tích theo SP', 'Xuất PDF'],
  },
  'tóm tắt 5 đơn chờ duyệt': {
    typing: 1000,
    chunks: [
      { tool: 'sales.order.list', delay: 0 },
      { text: 'Có **2 đơn chờ duyệt** (cả hai trên 50tr, kích hoạt workflow auto):', delay: 800 },
      { card: 'order-list', delay: 100 },
      { text: 'Bạn muốn mình **duyệt cả hai** hay xem chi tiết từng đơn?', delay: 300 },
    ],
    suggestions: ['Duyệt cả hai', 'Xem DH-0142', 'Xem DH-0138'],
  },
  default: {
    typing: 900,
    chunks: [{ text: 'Mình hiểu. Bạn có thể mô tả rõ hơn nhu cầu, hoặc thử một trong các gợi ý phía dưới?', delay: 0 }],
    suggestions: SUGGESTIONS_FIRST,
  },
};

const AgentPanel = ({ open, onClose }) => {
  const [messages, setMessages] = useState([
    { id: 'init', role: 'agent', kind: 'text', text: 'Xin chào! Mình là **Trợ lý ERP**. Mình có thể tạo đơn, soạn báo cáo, hoặc trả lời câu hỏi về dữ liệu của bạn.' },
  ]);
  const [suggestions, setSuggestions] = useState(SUGGESTIONS_FIRST);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { id: 'm' + Date.now(), role: 'user', kind: 'text', text };
    setMessages((ms) => [...ms, userMsg]);
    setInput('');
    setTyping(true);
    setSuggestions([]);

    const key = text.trim().toLowerCase();
    const matched = Object.keys(SCRIPT).find((k) => key.includes(k)) || 'default';
    const plan = SCRIPT[matched];

    let acc = 0;
    setTimeout(() => setTyping(false), plan.typing);
    plan.chunks.forEach((c, i) => {
      acc += c.delay || 0;
      setTimeout(() => {
        const id = `r${Date.now()}_${i}`;
        if (c.tool) {
          setMessages((ms) => [...ms, { id, role: 'agent', kind: 'tool', tool: c.tool, state: 'running' }]);
          setTimeout(() => {
            setMessages((ms) => ms.map((m) => m.id === id ? { ...m, state: 'done' } : m));
          }, 600);
        } else if (c.text) {
          setMessages((ms) => [...ms, { id, role: 'agent', kind: 'text', text: c.text }]);
        } else if (c.card) {
          setMessages((ms) => [...ms, { id, role: 'agent', kind: 'card', card: c.card }]);
        }
      }, plan.typing + acc);
    });
    setTimeout(() => setSuggestions(plan.suggestions || []), plan.typing + acc + 300);
  };

  if (!open) return null;

  return (
    <div className="fixed top-12 right-0 bottom-0 w-[400px] panel border-l border-border z-40 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="h-12 shrink-0 px-3 flex items-center border-b border-border gap-2">
        <span className="w-7 h-7 rounded-md flex items-center justify-center text-white"
              style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
          <I.Sparkles size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight">Trợ lý ERP</div>
          <div className="text-[11px] text-muted flex items-center gap-1.5">
            <span className="chip chip-accent" style={{ height: 14, fontSize: 9, padding: '0 4px' }}>Sonnet 4</span>
            8 tools · MCP connected
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<I.More size={14} />} />
        <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />} />
      </div>

      {/* Messages */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => <Message key={m.id} m={m} />)}
        {typing && (
          <div className="flex items-end gap-2">
            <Avatar role="agent" />
            <div className="bg-panel-2 border border-border rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
              <Dot /><Dot d={0.15} /><Dot d={0.3} />
            </div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && !typing && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="chip hover:border-accent hover:text-accent">
              <I.Sparkles size={10} /> {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-2.5">
        <div className="flex items-end gap-2 bg-bg-soft border border-border rounded-lg p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }}}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm placeholder:text-muted leading-relaxed max-h-32"
            placeholder="Hỏi gì đó… (vd: tóm tắt đơn chờ duyệt)"
          />
          <button className="w-7 h-7 rounded-md hover:bg-hover/40 flex items-center justify-center text-muted" title="Voice">
            <I.Mic size={13} />
          </button>
          <button onClick={() => send(input)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
            <I.Send size={13} />
          </button>
        </div>
        <div className="text-[10px] text-muted mt-1.5 flex items-center justify-between">
          <span>Enter để gửi · Shift+Enter xuống dòng</span>
          <span><span className="kbd">⌘</span><span className="kbd">/</span> mở chat</span>
        </div>
      </div>
    </div>
  );
};

const Avatar = ({ role }) => (
  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
    role === 'user' ? 'bg-panel-2 border border-border text-text' : 'text-white'
  }`}
       style={role === 'user' ? {} : { background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
    {role === 'user' ? 'TV' : <I.Sparkles size={11} />}
  </div>
);

const Dot = ({ d = 0 }) => (
  <span className="w-1.5 h-1.5 rounded-full bg-muted" style={{
    animation: `dot 1.2s ${d}s infinite`,
  }}></span>
);

const Message = ({ m }) => {
  if (m.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[80%] text-white"
             style={{ background: 'hsl(var(--accent))' }}>
          {m.text}
        </div>
        <Avatar role="user" />
      </div>
    );
  }
  // agent
  return (
    <div className="flex items-start gap-2">
      <Avatar role="agent" />
      <div className="max-w-[85%] flex-1 min-w-0">
        {m.kind === 'text' && (
          <div className="bg-panel-2 border border-border rounded-2xl rounded-bl-sm px-3 py-2 text-sm"
               dangerouslySetInnerHTML={{ __html: renderMD(m.text) }} />
        )}
        {m.kind === 'tool' && (
          <div className="flex items-center gap-2 text-xs text-muted py-1">
            {m.state === 'done'
              ? <I.Check size={12} className="text-success" />
              : <I.Loader size={12} className="animate-spin text-accent-2" />
            }
            <span>{m.state === 'done' ? 'Đã gọi' : 'Đang gọi tool'}</span>
            <span className="font-mono text-accent-2">{m.tool}</span>
          </div>
        )}
        {m.kind === 'card' && <AgentCard variant={m.card} />}
      </div>
    </div>
  );
};

const renderMD = (s = '') => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<code class="font-mono bg-bg-soft px-1 rounded">$1</code>')
  .replace(/\n/g, '<br>');

const AgentCard = ({ variant }) => {
  if (variant === 'customer-pick') {
    return (
      <div className="card divide-y divide-border overflow-hidden">
        {['Công ty TNHH Minh Phúc', 'CP Sao Mai', 'Cửa hàng Thiên Hương'].map((c, i) => (
          <button key={c} className="w-full text-left px-3 py-2 hover:bg-hover/30 flex items-center gap-2">
            <I.Users size={13} className="text-muted" />
            <span className="flex-1 text-sm">{c}</span>
            <I.ChevronRight size={12} className="text-muted" />
          </button>
        ))}
      </div>
    );
  }
  if (variant === 'chart') {
    return (
      <div className="card p-3">
        <div className="text-xs text-muted mb-1">Doanh thu 7 ngày qua</div>
        <div className="h-[110px]"><MiniChart /></div>
      </div>
    );
  }
  if (variant === 'order-list') {
    return (
      <div className="card divide-y divide-border overflow-hidden">
        {ORDER_ROWS.filter((r) => r.status === 'Chờ duyệt').map((r) => (
          <div key={r.id} className="px-3 py-2">
            <div className="text-xs font-mono text-muted">{r.id}</div>
            <div className="text-sm">{r.customer}</div>
            <div className="text-sm font-semibold text-accent">{formatVND(r.total)}</div>
            <div className="mt-1.5 flex gap-1">
              <button className="btn btn-default btn-sm">Xem</button>
              <button className="btn btn-primary btn-sm"><I.Check size={11} /> Duyệt</button>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Inject typing dot keyframes
const style = document.createElement('style');
style.innerHTML = `@keyframes dot { 0%,60%,100% { opacity: 0.2; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }`;
document.head.appendChild(style);

Object.assign(window, { AgentPanel });
