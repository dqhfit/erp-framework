/* App shell: Topbar + Sidebar + main layout slot */

const Topbar = ({
  route, setRoute, mode, setMode, theme, setTheme,
  onOpenCmd, onOpenAgent, sidebarCollapsed, setSidebarCollapsed,
  agentOpen,
}) => {
  return (
    <div className="h-12 shrink-0 flex items-center px-3 gap-1.5 sm:gap-2 border-b border-border bg-panel/70 backdrop-blur sticky top-0 z-50 whitespace-nowrap">
      {/* Brand */}
      <button
        onClick={() => setRoute({ kind: 'home' })}
        className="flex items-center gap-2 px-1.5 h-8 rounded-md hover:bg-hover/50"
      >
        <span className="w-6 h-6 rounded-md flex items-center justify-center text-white"
              style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
          <I.Bolt size={14} strokeWidth={2.5} />
        </span>
        <span className="font-semibold tracking-tight">ERP Framework</span>
        <span className="chip" style={{ height: 18, fontSize: 10 }}>v1.0</span>
      </button>

      <div className="w-px h-5 bg-border mx-1"></div>

      {/* Sidebar toggle */}
      <Button variant="ghost" size="sm" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        icon={<I.PanelLeft size={14} />} title="Toggle sidebar" />

      {/* Search / Command */}
      <button
        onClick={onOpenCmd}
        className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-bg-soft border border-border text-muted hover:text-text hover:border-hover transition-colors min-w-0 flex-1 max-w-[420px] mx-2 whitespace-nowrap overflow-hidden"
      >
        <I.Search size={14} className="shrink-0" />
        <span className="text-sm truncate hidden sm:inline">Tìm hoặc gõ lệnh…</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <span className="kbd">⌘</span><span className="kbd">K</span>
        </span>
      </button>

      <div className="flex-1 min-w-0"></div>

      {/* Mode toggle (Edit / Preview) — only relevant in designer routes */}
      {['entity', 'page', 'workflow'].includes(route.kind) && (
        <div className="mode-toggle shrink-0">
          <button className={mode === 'designer' ? 'on' : ''} onClick={() => setMode('designer')}>
            <span className="inline-flex items-center gap-1.5"><I.Edit size={11} /> Edit</span>
          </button>
          <button className={mode === 'consumer' ? 'on' : ''} onClick={() => setMode('consumer')}>
            <span className="inline-flex items-center gap-1.5"><I.Eye size={11} /> Preview</span>
          </button>
        </div>
      )}

      {/* MCP status */}
      <button
        onClick={() => setRoute({ kind: 'settings-mcp' })}
        className="hidden md:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm shrink-0"
        title="MCP connected"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
        <I.Server size={14} className="text-muted" />
        <span className="text-muted">MCP</span>
      </button>

      {/* LLM profile */}
      <button
        onClick={() => setRoute({ kind: 'settings-llm' })}
        className="hidden lg:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm shrink-0"
        title="LLM profile"
      >
        <I.Sparkles size={14} className="text-accent" />
        <span className="text-muted">Sonnet 4</span>
      </button>

      {/* Theme toggle */}
      <Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        icon={theme === 'dark' ? <I.Sun size={14} /> : <I.Moon size={14} />} title="Toggle theme" />

      {/* Notifications */}
      <Button variant="ghost" size="sm" icon={<I.Bell size={14} />} title="Notifications" className="hidden md:inline-flex" />

      {/* Agent button */}
      <Button variant={agentOpen ? 'primary' : 'default'} size="sm" onClick={onOpenAgent}
              icon={<I.Sparkles size={14} />} className="shrink-0">
        <span className="hidden sm:inline">Hỏi Agent</span>
      </Button>

      {/* User */}
      <button className="ml-1 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}
              title="Toàn Vũ — Admin">
        TV
      </button>
    </div>
  );
};

const SidebarSection = ({ title, collapsed, items, route, setRoute, addLabel, onAdd }) => (
  <div className="mb-1.5">
    {!collapsed && (
      <div className="flex items-center justify-between px-3 mt-3 mb-1">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted">{title}</div>
        {onAdd && (
          <button onClick={onAdd} className="w-5 h-5 rounded hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text" title={addLabel}>
            <I.Plus size={12} />
          </button>
        )}
      </div>
    )}
    {items.map((item) => {
      const IconC = I[item.icon] || I.Folder;
      const active = route.kind === item.routeKind && route.id === item.id;
      return (
        <div
          key={item.id}
          onClick={() => setRoute({ kind: item.routeKind, id: item.id })}
          className={`sidebar-item ${active ? 'active' : ''}`}
          title={collapsed ? item.name : ''}
        >
          <IconC size={14} className="icon text-muted shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate flex-1">{item.name}</span>
              {item.badge && <span className="chip" style={{ height: 16, fontSize: 10, padding: '0 5px' }}>{item.badge}</span>}
            </>
          )}
        </div>
      );
    })}
  </div>
);

const Sidebar = ({ collapsed, route, setRoute, onOpenAgent }) => {
  return (
    <aside
      className="shrink-0 border-r border-border bg-panel flex flex-col overflow-hidden"
      style={{ width: collapsed ? 56 : 240, transition: 'width 180ms ease' }}
    >
      <div className="flex-1 overflow-y-auto py-1">
        {/* Home */}
        <div className={`sidebar-item ${route.kind === 'home' ? 'active' : ''}`}
             onClick={() => setRoute({ kind: 'home' })}
             title={collapsed ? 'Workspace' : ''}>
          <I.Home size={14} className="icon text-muted shrink-0" />
          {!collapsed && <span className="truncate">Workspace</span>}
        </div>

        <SidebarSection
          title="Entities"
          collapsed={collapsed}
          items={ENTITIES.map((e) => ({ id: e.id, name: e.name, icon: e.icon, routeKind: 'entity' }))}
          route={route} setRoute={setRoute}
          addLabel="New entity" onAdd={() => {}}
        />

        <SidebarSection
          title="Pages"
          collapsed={collapsed}
          items={PAGES.map((p) => ({ id: p.id, name: p.name, icon: p.icon, routeKind: 'page' }))}
          route={route} setRoute={setRoute}
          addLabel="New page" onAdd={() => {}}
        />

        <SidebarSection
          title="Workflows"
          collapsed={collapsed}
          items={WORKFLOWS.map((w) => ({ id: w.id, name: w.name, icon: w.icon, routeKind: 'workflow',
            badge: w.status === 'paused' ? '⏸' : null }))}
          route={route} setRoute={setRoute}
          addLabel="New workflow" onAdd={() => {}}
        />

        <SidebarSection
          title="Agents"
          collapsed={collapsed}
          items={AGENTS.map((a) => ({ id: a.id, name: a.name, icon: 'Bot', routeKind: 'agent' }))}
          route={route} setRoute={setRoute}
          addLabel="New agent" onAdd={onOpenAgent}
        />
      </div>

      {/* Bottom: settings */}
      <div className="border-t border-border py-1">
        <div className={`sidebar-item ${route.kind === 'settings-llm' ? 'active' : ''}`}
             onClick={() => setRoute({ kind: 'settings-llm' })}
             title={collapsed ? 'LLM Profiles' : ''}>
          <I.Sparkles size={14} className="icon text-muted shrink-0" />
          {!collapsed && <span className="truncate">LLM Profiles</span>}
        </div>
        <div className={`sidebar-item ${route.kind === 'settings-mcp' ? 'active' : ''}`}
             onClick={() => setRoute({ kind: 'settings-mcp' })}
             title={collapsed ? 'MCP' : ''}>
          <I.Server size={14} className="icon text-muted shrink-0" />
          {!collapsed && <span className="truncate">MCP Server</span>}
        </div>
        <div className="sidebar-item" title={collapsed ? 'Settings' : ''}>
          <I.Settings size={14} className="icon text-muted shrink-0" />
          {!collapsed && <span className="truncate">Settings</span>}
        </div>
      </div>
    </aside>
  );
};

Object.assign(window, { Topbar, Sidebar });
