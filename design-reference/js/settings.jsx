/* Settings — LLM Profiles + MCP */

const ADAPTERS = {
  anthropic: { label: 'Anthropic',  color: 'accent',   docs: 'console.anthropic.com' },
  openai:    { label: 'OpenAI',     color: 'success',  docs: 'platform.openai.com' },
  google:    { label: 'Google',     color: 'accent-2', docs: 'ai.google.dev' },
  ollama:    { label: 'Local',      color: 'warning',  docs: 'ollama.com' },
};

const SettingsLLM = () => {
  const toast = useToast();
  const [profiles, setProfiles] = useState(LLM_PROFILES);
  const [edit, setEdit] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const setDefault = (id) => {
    setProfiles((ps) => ps.map((p) => ({ ...p, isDefault: p.id === id })));
    toast.success('Đã đặt làm mặc định');
  };

  const test = () => {
    setTesting(true); setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult({ ok: true, latency: 312, response: 'Xin chào! Tôi có thể giúp gì cho bạn?' });
    }, 1100);
  };

  return (
    <div className="overflow-y-auto h-full" data-screen-label="Settings · LLM Profiles">
      <div className="max-w-[1100px] mx-auto p-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-xs text-muted">Settings</div>
            <h1 className="text-2xl font-semibold">LLM Profiles</h1>
            <p className="text-sm text-muted mt-1">Quản lý các profile model để workflow & agent gọi tới.</p>
          </div>
          <Button variant="primary" icon={<I.Plus size={14} />} onClick={() => setEdit({ id: null, name: '', adapter: 'anthropic', model: '' })}>Thêm profile</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profiles.map((p) => {
            const a = ADAPTERS[p.adapter];
            return (
              <div key={p.id} className="card p-4 hover:border-hover">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center
                    ${a.color === 'accent' ? 'bg-accent/15 text-accent' :
                      a.color === 'accent-2' ? 'bg-accent-2/15 text-accent-2' :
                      a.color === 'success' ? 'bg-success/15 text-success' :
                      'bg-warning/15 text-warning'}`}>
                    <I.Sparkles size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{p.name}</div>
                      {p.isDefault && <span className="chip chip-accent" style={{ height: 18, fontSize: 10 }}>Default</span>}
                    </div>
                    <div className="text-xs text-muted mt-0.5 font-mono">{p.adapter} · {p.model}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {p.hasKey ? (
                      <span className="chip chip-success" style={{ height: 20, fontSize: 10 }}><I.Check size={9} /> API key</span>
                    ) : (
                      <span className="chip chip-danger" style={{ height: 20, fontSize: 10 }}><I.X size={9} /> No key</span>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={() => setEdit(p)} icon={<I.Edit size={11} />}>Edit</Button>
                  {!p.isDefault && <Button variant="ghost" size="sm" onClick={() => setDefault(p.id)}>Set default</Button>}
                  <div className="flex-1"></div>
                  <button className="text-muted hover:text-danger" onClick={() =>
                    setProfiles((ps) => ps.filter((x) => x.id !== p.id))
                  }>
                    <I.Trash size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={!!edit} onClose={() => { setEdit(null); setTestResult(null); }}
             title={edit?.id ? 'Sửa LLM Profile' : 'Tạo LLM Profile'}
             width={520}
             footer={
               <>
                 <Button variant="ghost" onClick={() => { setEdit(null); setTestResult(null); }}>Huỷ</Button>
                 <Button variant="default" onClick={test} icon={testing ? <I.Loader size={13} className="animate-spin" /> : <I.Sparkles size={13} />}>
                   {testing ? 'Đang test…' : 'Test "Xin chào"'}
                 </Button>
                 <Button variant="primary" icon={<I.Save size={13} />} onClick={() => {
                   if (!edit.id) {
                     setProfiles((ps) => [...ps, { ...edit, id: 'l' + (ps.length + 1) }]);
                     toast.success('Đã thêm profile');
                   } else {
                     setProfiles((ps) => ps.map((p) => p.id === edit.id ? edit : p));
                     toast.success('Đã lưu profile');
                   }
                   setEdit(null); setTestResult(null);
                 }}>Lưu</Button>
               </>
             }>
        {edit && (
          <div className="space-y-3">
            <FormField label="Tên profile"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Adapter">
                <select className="input" value={edit.adapter} onChange={(e) => setEdit({ ...edit, adapter: e.target.value })}>
                  {Object.entries(ADAPTERS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}
                </select>
              </FormField>
              <FormField label="Model"><input className="input font-mono" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} placeholder="vd: claude-sonnet-4" /></FormField>
            </div>
            <FormField label="API key" hint="Mã hoá trên server, không bao giờ trả về client.">
              <input className="input font-mono" type="password" placeholder="sk-…" defaultValue={edit.hasKey ? '••••••••••••' : ''} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Temperature"><input className="input" type="number" step="0.1" defaultValue="0.3" /></FormField>
              <FormField label="Max tokens"><input className="input" type="number" defaultValue="2048" /></FormField>
            </div>

            {testResult && (
              <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <I.Check size={14} className="text-success" />
                  <span className="font-semibold text-success">Kết nối thành công · {testResult.latency}ms</span>
                </div>
                <div className="font-mono text-xs bg-bg-soft p-2 rounded">{testResult.response}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

const SettingsMCP = () => {
  const toast = useToast();
  const [mode, setMode] = useState('http');
  const [tested, setTested] = useState(true);
  const [testing, setTesting] = useState(false);
  const tools = [
    { ns: 'crm', name: 'customer.list', desc: 'Liệt kê khách hàng', latency: 84 },
    { ns: 'crm', name: 'customer.get', desc: 'Lấy chi tiết khách hàng', latency: 62 },
    { ns: 'crm', name: 'customer.create', desc: 'Tạo khách hàng mới', latency: 138 },
    { ns: 'sales', name: 'order.list', desc: 'Liệt kê đơn hàng', latency: 92 },
    { ns: 'sales', name: 'order.update', desc: 'Cập nhật đơn hàng', latency: 146 },
    { ns: 'inv', name: 'product.list', desc: 'Liệt kê SKU', latency: 71 },
    { ns: 'inv', name: 'warehouse.move', desc: 'Tạo phiếu kho', latency: 184 },
    { ns: 'hr', name: 'employee.list', desc: 'Liệt kê nhân viên', latency: 88 },
    { ns: 'acc', name: 'invoice.create', desc: 'Tạo hoá đơn', latency: 156 },
    { ns: 'notif', name: 'email.send', desc: 'Gửi email', latency: 220 },
  ];

  const test = () => {
    setTesting(true); setTested(false);
    setTimeout(() => { setTesting(false); setTested(true); toast.success('Kết nối MCP OK · 10 tools'); }, 900);
  };

  return (
    <div className="overflow-y-auto h-full" data-screen-label="Settings · MCP">
      <div className="max-w-[1100px] mx-auto p-8">
        <div className="mb-6">
          <div className="text-xs text-muted">Settings</div>
          <h1 className="text-2xl font-semibold">MCP Server</h1>
          <p className="text-sm text-muted mt-1">Kết nối tới Model Context Protocol server của doanh nghiệp.</p>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          <div className="card p-5 space-y-4">
            <FormField label="Mode">
              <div className="mode-toggle">
                <button className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>Demo (in-process)</button>
                <button className={mode === 'http' ? 'on' : ''} onClick={() => setMode('http')}>HTTP</button>
              </div>
            </FormField>

            {mode === 'http' && (
              <>
                <FormField label="URL"><input className="input font-mono" defaultValue="https://mcp.acme.vn/v1" /></FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Timeout (s)"><input className="input" type="number" defaultValue="30" /></FormField>
                  <FormField label="Retry"><input className="input" type="number" defaultValue="3" /></FormField>
                </div>
                <FormField label="Headers (JSON)">
                  <textarea className="input font-mono" rows={4}
                    defaultValue={'{\n  "X-Tenant": "acme",\n  "Authorization": "Bearer ${secrets.mcp_token}"\n}'} />
                </FormField>
              </>
            )}

            {mode === 'demo' && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-warning mb-1">
                  <I.AlertCircle size={14} /> Demo mode
                </div>
                Dùng dữ liệu giả lập trong RAM. Không phù hợp production. Chuyển sang HTTP khi triển khai thật.
              </div>
            )}

            <div className="pt-2 flex items-center gap-2">
              <Button variant="default" onClick={test} icon={testing ? <I.Loader size={13} className="animate-spin" /> : <I.Power size={13} />}>
                {testing ? 'Đang test…' : 'Test connection'}
              </Button>
              <Button variant="primary" icon={<I.Save size={13} />}>Lưu</Button>
              {tested && !testing && (
                <span className="text-success text-sm ml-2 flex items-center gap-1">
                  <I.Check size={12} /> Connected · {tools.length} tools
                </span>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              <div className="font-semibold">Status</div>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Server</dt><dd className="font-mono text-xs">mcp.acme.vn/v1</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tools</dt><dd>{tools.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Latency p50</dt><dd>104 ms</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Calls 24h</dt><dd>1.842</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Error rate</dt><dd className="text-success">0.2%</dd></div>
            </dl>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Available tools</h2>
          <div className="card overflow-hidden">
            {tools.map((t, i) => (
              <div key={i} className="flex items-center gap-3 px-4 h-11 border-b border-border last:border-b-0 hover:bg-hover/30">
                <span className="chip" style={{ height: 20, fontSize: 11 }}>{t.ns}</span>
                <span className="font-mono text-sm">{t.name}</span>
                <span className="text-sm text-muted flex-1 truncate">{t.desc}</span>
                <span className="text-xs text-muted font-mono">{t.latency}ms</span>
                <I.ChevronRight size={13} className="text-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SettingsLLM, SettingsMCP });
