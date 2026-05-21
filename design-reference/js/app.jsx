/* Main App — wires shell + screens + tweaks + global keyboard shortcuts */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "violet",
  "density": "comfortable",
  "sidebarCollapsed": false,
  "inspectorVisible": true
}/*EDITMODE-END*/;

const ACCENT_HEX = {
  violet: '#7c5cff',
  cyan:   '#00d4ff',
  green:  '#22c55e',
  amber:  '#ff9933',
};

const App = () => {
  // Tweaks (persisted via host)
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Route
  const [route, setRoute] = useState({ kind: 'home' });
  const [mode, setMode] = useState('designer'); // designer | consumer (only meaningful in designer routes)
  const [agentOpen, setAgentOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply theme + density + accent to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', tweaks.theme === 'light');
    root.classList.toggle('dark', tweaks.theme === 'dark');
    root.classList.toggle('density-compact', tweaks.density === 'compact');
    ['violet', 'cyan', 'green', 'amber'].forEach((a) => root.classList.toggle('accent-' + a, tweaks.accent === a && a !== 'violet'));
  }, [tweaks.theme, tweaks.density, tweaks.accent]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      if (mod && e.key === '/') { e.preventDefault(); setAgentOpen((v) => !v); }
      if (e.key === 'Escape') {
        if (cmdOpen) setCmdOpen(false);
      }
      if (e.key === '/' && !cmdOpen && !agentOpen && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdOpen, agentOpen]);

  const setTheme = (t) => setTweak('theme', t);

  const onRunCmd = (r) => {
    if (r.kind === '__agent__') { setAgentOpen(true); return; }
    if (r.kind === '__mobile__') { setMobileOpen(true); return; }
    setRoute(r);
  };

  // Reset mode when leaving designer route
  useEffect(() => {
    if (!['entity', 'page', 'workflow'].includes(route.kind)) setMode('designer');
  }, [route.kind]);

  return (
    <ToastHost>
      <div className="h-screen flex flex-col">
        <Topbar
          route={route} setRoute={setRoute}
          mode={mode} setMode={setMode}
          theme={tweaks.theme} setTheme={setTheme}
          onOpenCmd={() => setCmdOpen(true)}
          onOpenAgent={() => setAgentOpen((v) => !v)}
          sidebarCollapsed={tweaks.sidebarCollapsed}
          setSidebarCollapsed={(v) => setTweak('sidebarCollapsed', v)}
          agentOpen={agentOpen}
        />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            collapsed={tweaks.sidebarCollapsed}
            route={route} setRoute={setRoute}
            onOpenAgent={() => setAgentOpen(true)}
          />
          <main className="flex-1 overflow-hidden flex flex-col" style={{ marginRight: agentOpen ? 400 : 0, transition: 'margin 200ms ease' }}>
            {route.kind === 'home' && <HomeScreen setRoute={setRoute} onOpenAgent={() => setAgentOpen(true)} />}
            {route.kind === 'entity' && (
              mode === 'consumer'
                ? <EntityDesigner entityId={route.id} mode="consumer" inspectorVisible={false} density={tweaks.density} />
                : <EntityDesigner entityId={route.id} mode={mode} inspectorVisible={tweaks.inspectorVisible} density={tweaks.density} />
            )}
            {route.kind === 'page' && (
              mode === 'consumer'
                ? <ConsumerPage pageId={route.id} onOpenAgent={() => setAgentOpen(true)} />
                : <PageDesigner pageId={route.id} mode={mode} inspectorVisible={tweaks.inspectorVisible} />
            )}
            {route.kind === 'workflow' && (
              <WorkflowDesigner workflowId={route.id} mode={mode} inspectorVisible={tweaks.inspectorVisible} />
            )}
            {route.kind === 'agent' && <AgentScreen agentId={route.id} onOpenAgent={() => setAgentOpen(true)} />}
            {route.kind === 'settings-llm' && <SettingsLLM />}
            {route.kind === 'settings-mcp' && <SettingsMCP />}
          </main>
        </div>

        <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onRun={onRunCmd} />
        {mobileOpen && <MobileDashboard onClose={() => setMobileOpen(false)} onOpenAgent={() => { setMobileOpen(false); setAgentOpen(true); }} />}

        {/* Tweaks panel */}
        <TweaksPanel title="Tweaks">
          <TweakSection label="Theme">
            <TweakRadio label="Mode" value={tweaks.theme}
                        options={['dark', 'light']}
                        onChange={(v) => setTweak('theme', v)} />
            <TweakColor label="Accent" value={ACCENT_HEX[tweaks.accent]}
                        options={Object.values(ACCENT_HEX)}
                        onChange={(hex) => {
                          const key = Object.entries(ACCENT_HEX).find(([, v]) => v === hex)?.[0] || 'violet';
                          setTweak('accent', key);
                        }} />
            <TweakRadio label="Density" value={tweaks.density}
                        options={['comfortable', 'compact']}
                        onChange={(v) => setTweak('density', v)} />
          </TweakSection>
          <TweakSection label="Layout">
            <TweakToggle label="Sidebar collapsed" value={tweaks.sidebarCollapsed}
                         onChange={(v) => setTweak('sidebarCollapsed', v)} />
            <TweakToggle label="Inspector (Designer)" value={tweaks.inspectorVisible}
                         onChange={(v) => setTweak('inspectorVisible', v)} />
          </TweakSection>
          <TweakSection label="Demo">
            <TweakButton onClick={() => setAgentOpen(true)} label="Open Agent Chat" />
            <TweakButton onClick={() => setCmdOpen(true)} label="Open Command Palette" />
            <TweakButton onClick={() => setMobileOpen(true)} label="Open Sếp Mobile" />
          </TweakSection>
        </TweaksPanel>
      </div>
    </ToastHost>
  );
};

// Simple agent detail screen
const AgentScreen = ({ agentId, onOpenAgent }) => {
  const agent = AGENTS.find((a) => a.id === agentId) || AGENTS[0];
  return (
    <div className="overflow-y-auto h-full" data-screen-label={`Agent · ${agent.name}`}>
      <div className="max-w-[900px] mx-auto p-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-12 h-12 rounded-lg flex items-center justify-center text-white"
                style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
            <I.Bot size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{agent.name}</h1>
            <div className="text-xs text-muted font-mono">{agent.model} · {agent.tools} tools</div>
          </div>
          <div className="flex-1"></div>
          <Button variant="primary" icon={<I.Sparkles size={13} />} onClick={onOpenAgent}>Trò chuyện</Button>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4">
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">System prompt</div>
              <pre className="font-mono text-xs whitespace-pre-wrap bg-bg-soft border border-border rounded-md p-3">
{`Bạn là trợ lý ${agent.name.toLowerCase()} cho công ty.
Quy tắc:
- Trả lời tiếng Việt, ngắn gọn, thân thiện.
- Trước khi tạo / sửa dữ liệu, hãy xác nhận lại với người dùng.
- Dùng các tool MCP có sẵn để truy vấn dữ liệu thật.`}
              </pre>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Tools ({agent.tools})</div>
              <div className="flex flex-wrap gap-1.5">
                {['crm.customer.list','crm.customer.get','sales.order.list','sales.order.create','inv.product.list','analytics.aggregate','notif.email.send','calendar.book'].slice(0, agent.tools).map((t) => (
                  <span key={t} className="chip chip-accent font-mono">{t}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="font-semibold mb-2">30 ngày gần đây</div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Conversations</dt><dd>418</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tool calls</dt><dd>1.122</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Đánh giá</dt><dd>★ 4.7</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Token / msg</dt><dd>1,2k</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};

// Mount
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
