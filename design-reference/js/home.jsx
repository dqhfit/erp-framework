/* Home / Workspace */

const HomeScreen = ({ setRoute, onOpenAgent }) => {
  const stats = [
    { label: 'Entities', value: ENTITIES.length, icon: 'Database', tint: 'accent' },
    { label: 'Pages', value: PAGES.length, icon: 'Layout', tint: 'accent-2' },
    { label: 'Workflows', value: WORKFLOWS.length, icon: 'Workflow', tint: 'success' },
    { label: 'Agents', value: AGENTS.length, icon: 'Bot', tint: 'warning' },
  ];

  const recents = [
    { kind: 'entity',   id: 'order',     name: 'Đơn hàng',           icon: 'Cart',     time: '2 phút trước', who: 'bạn' },
    { kind: 'page',     id: 'p_dashboard', name: 'Bảng điều khiển kinh doanh', icon: 'BarChart', time: '12 phút trước', who: 'bạn' },
    { kind: 'workflow', id: 'w_approve_big_order', name: 'Duyệt đơn hàng > 50tr', icon: 'Workflow', time: '1 giờ trước', who: 'Chị Linh' },
    { kind: 'entity',   id: 'customer',  name: 'Khách hàng',         icon: 'Users',    time: '3 giờ trước', who: 'bạn' },
    { kind: 'page',     id: 'p_orders',  name: 'Quản lý đơn hàng',   icon: 'Cart',     time: 'hôm qua', who: 'Anh Đức' },
  ];

  const templates = [
    { name: 'CRM cơ bản',           desc: 'Khách hàng, Cơ hội, Hợp đồng',   icon: 'Users',    tint: 'accent' },
    { name: 'Quản lý đơn hàng',     desc: 'Đơn, Khách hàng, Sản phẩm',     icon: 'Cart',     tint: 'accent-2' },
    { name: 'Kho thông minh',       desc: 'Kho, Sản phẩm, Phiếu nhập xuất',icon: 'Warehouse', tint: 'success' },
    { name: 'HR + Chấm công',       desc: 'Nhân viên, Chấm công, Nghỉ phép', icon: 'Briefcase', tint: 'warning' },
  ];

  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1180px] mx-auto px-8 py-10">

        {/* Hero */}
        <div className="mb-8">
          <div className="text-sm text-muted mb-1">{greet}, Toàn</div>
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight mb-4">
            Bạn muốn xây gì hôm nay?
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" icon={<I.Database size={14} />}
                    onClick={() => setRoute({ kind: 'entity', id: 'customer' })}>
              + Entity mới
            </Button>
            <Button variant="default" size="lg" icon={<I.Layout size={14} />}
                    onClick={() => setRoute({ kind: 'page', id: 'p_orders' })}>
              + Page mới
            </Button>
            <Button variant="default" size="lg" icon={<I.Workflow size={14} />}
                    onClick={() => setRoute({ kind: 'workflow', id: 'w_approve_big_order' })}>
              + Workflow mới
            </Button>
            <Button variant="ghost" size="lg" icon={<I.Sparkles size={14} />} onClick={onOpenAgent}>
              + Agent mới
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map((s) => {
            const IconC = I[s.icon];
            return (
              <div key={s.label} className="card p-4 hover:border-hover transition-colors cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider">{s.label}</div>
                    <div className="text-[28px] font-semibold mt-1 leading-none">{s.value}</div>
                  </div>
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center
                    ${s.tint === 'accent' ? 'bg-accent/15 text-accent' :
                      s.tint === 'accent-2' ? 'bg-accent-2/15 text-accent-2' :
                      s.tint === 'success' ? 'bg-success/15 text-success' :
                      'bg-warning/15 text-warning'}`}>
                    <IconC size={16} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          {/* Recents */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold">Gần đây</h2>
              <button className="text-xs text-muted hover:text-text">Xem tất cả</button>
            </div>
            <div className="card divide-y divide-border">
              {recents.map((r, i) => {
                const IconC = I[r.icon];
                return (
                  <div key={i}
                       onClick={() => setRoute({ kind: r.kind, id: r.id })}
                       className="flex items-center gap-3 p-3 hover:bg-hover/30 cursor-pointer group">
                    <div className="w-8 h-8 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted group-hover:text-text">
                      <IconC size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted">
                        <span className="capitalize">{r.kind}</span> · cập nhật {r.time} bởi {r.who}
                      </div>
                    </div>
                    <I.ChevronRight size={14} className="text-muted opacity-0 group-hover:opacity-100" />
                  </div>
                );
              })}
            </div>

            <h2 className="text-lg font-semibold mt-8 mb-3">Bắt đầu nhanh với template</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {templates.map((t) => {
                const IconC = I[t.icon];
                return (
                  <div key={t.name} className="card p-4 hover:border-accent/50 cursor-pointer transition-colors group">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3
                      ${t.tint === 'accent' ? 'bg-accent/15 text-accent' :
                        t.tint === 'accent-2' ? 'bg-accent-2/15 text-accent-2' :
                        t.tint === 'success' ? 'bg-success/15 text-success' :
                        'bg-warning/15 text-warning'}`}>
                      <IconC size={18} />
                    </div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted mt-0.5">{t.desc}</div>
                    <div className="mt-3 text-xs text-accent opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      Dùng template <I.ArrowRight size={11} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side rail */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
                  <I.Sparkles size={14} className="text-white" />
                </span>
                <div className="font-semibold">Trợ lý ERP</div>
              </div>
              <p className="text-sm text-muted mb-3">
                Mô tả nhu cầu, AI sẽ phác thảo entity + workflow giúp bạn.
              </p>
              <textarea
                rows={3}
                placeholder="Ví dụ: Tôi muốn quản lý đơn hàng, tự duyệt nếu < 5tr, gửi email khi đã giao."
                className="input mb-2"
              />
              <Button variant="primary" className="w-full justify-center" icon={<I.Sparkles size={14} />}
                      onClick={onOpenAgent}>
                Phác thảo bằng AI
              </Button>
            </div>

            <div className="card p-4">
              <div className="font-semibold mb-3 flex items-center gap-2">
                <I.Activity size={14} className="text-success" /> Hoạt động hệ thống
              </div>
              <ul className="space-y-2.5 text-sm">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-success mt-1.5"></span>
                  <div className="flex-1">
                    <div>Workflow <b>Duyệt đơn hàng &gt; 50tr</b> chạy thành công</div>
                    <div className="text-xs text-muted">5 phút trước · DH-0142</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-2 mt-1.5"></span>
                  <div className="flex-1">
                    <div>MCP <b>crm.customer</b> đồng bộ 1,204 bản ghi</div>
                    <div className="text-xs text-muted">28 phút trước</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5"></span>
                  <div className="flex-1">
                    <div>Cảnh báo tồn kho thấp · 3 SKU</div>
                    <div className="text-xs text-muted">1 giờ trước</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5"></span>
                  <div className="flex-1">
                    <div><b>Chị Linh</b> chỉnh sửa Workflow <b>Onboarding</b></div>
                    <div className="text-xs text-muted">3 giờ trước</div>
                  </div>
                </li>
              </ul>
            </div>

            <div className="card p-4 bg-bg-soft">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Mẹo nhanh</div>
              <div className="text-sm mb-3">Mở Command Palette bằng <span className="kbd">⌘</span> <span className="kbd">K</span> để tìm bất kỳ thứ gì.</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="chip">⌘S Lưu</span>
                <span className="chip">⌘Z Hoàn tác</span>
                <span className="chip">/ Tìm</span>
                <span className="chip">? Phím tắt</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { HomeScreen });
