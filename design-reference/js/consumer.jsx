/* Consumer page rendering + Sếp mobile dashboard */

const ConsumerPage = ({ pageId, onOpenAgent }) => {
  const page = PAGES.find((p) => p.id === pageId) || PAGES[0];

  // For Consumer Mode, render the saved layout as a real, working data page.
  if (page.id === 'p_orders') return <OrdersConsumer onOpenAgent={onOpenAgent} />;
  if (page.id === 'p_dashboard') return <DashboardConsumer onOpenAgent={onOpenAgent} />;
  if (page.id === 'p_customers') return <CustomersConsumer onOpenAgent={onOpenAgent} />;
  if (page.id === 'p_inventory') return <InventoryConsumer onOpenAgent={onOpenAgent} />;
  return null;
};

const FloatingAgentBtn = ({ onClick }) => (
  <button onClick={onClick}
          className="fixed bottom-6 right-6 h-12 pl-3 pr-4 rounded-full shadow-xl flex items-center gap-2 text-white font-medium z-30 hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
    <I.Sparkles size={16} /> Hỏi agent
  </button>
);

// ---------- Orders ----------
const OrdersConsumer = ({ onOpenAgent }) => {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const filtered = ORDER_ROWS.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (q && !r.customer.toLowerCase().includes(q.toLowerCase()) && !r.id.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="overflow-y-auto h-full" data-screen-label="Consumer · Quản lý đơn hàng">
      <div className="max-w-[1280px] mx-auto p-6">
        <div className="flex items-baseline justify-between mb-1">
          <div>
            <div className="text-xs text-muted">Sales / Đơn hàng</div>
            <h1 className="text-2xl font-semibold tracking-tight">Quản lý đơn hàng</h1>
          </div>
          <Button variant="primary" icon={<I.Plus size={14} />}>Tạo đơn mới</Button>
        </div>
        <p className="text-sm text-muted mb-5">Trang được render từ PageDef · 142 đơn / 30 ngày qua</p>

        {/* Filter bar */}
        <div className="card p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-7" placeholder="Tìm theo mã đơn, khách hàng…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mode-toggle">
            {['all', 'Chờ duyệt', 'Đã duyệt', 'Đã giao', 'Huỷ'].map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Tất cả' : s}
              </button>
            ))}
          </div>
          <Button variant="default" size="sm" icon={<I.Filter size={13} />}>Filter</Button>
          <Button variant="default" size="sm" icon={<I.Calendar size={13} />}>30 ngày</Button>
          <div className="flex-1"></div>
          <span className="text-xs text-muted">{filtered.length} kết quả</span>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft text-xs text-muted">
              <tr>
                <th className="text-left font-medium px-3 py-2.5"><input type="checkbox" /></th>
                <th className="text-left font-medium px-3 py-2.5">Mã đơn</th>
                <th className="text-left font-medium px-3 py-2.5">Khách hàng</th>
                <th className="text-right font-medium px-3 py-2.5">Tổng tiền</th>
                <th className="text-left font-medium px-3 py-2.5">Trạng thái</th>
                <th className="text-left font-medium px-3 py-2.5">Ngày đặt</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}
                    onClick={() => setSelected(r)}
                    className={`border-t border-border hover:bg-hover/30 cursor-pointer ${selected?.id === r.id ? 'bg-accent/10' : ''}`}>
                  <td className="px-3 py-2.5"><input type="checkbox" onClick={(e) => e.stopPropagation()} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2.5">{r.customer}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatVND(r.total)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`chip ${
                      r.status === 'Chờ duyệt' ? 'chip-warning' :
                      r.status === 'Đã duyệt' ? 'chip-accent' :
                      r.status === 'Đã giao' ? 'chip-success' :
                      r.status === 'Huỷ' ? 'chip-danger' : ''
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted text-xs">{r.date}</td>
                  <td className="px-3 py-2.5 text-right">
                    <I.More size={14} className="text-muted" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="7">
                  <EmptyState icon={<I.Cart size={20} className="text-muted" />}
                              title="Không có đơn nào khớp" hint="Thử bỏ filter hoặc tìm với từ khoá khác." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Chi tiết ${selected.id}` : ''}
              width={460}
              footer={selected && (
                <div className="flex items-center justify-end gap-2 w-full">
                  <Button variant="ghost">Huỷ</Button>
                  <Button variant="primary" icon={<I.Check size={13} />}>Duyệt đơn</Button>
                </div>
              )}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
                <I.Cart size={20} />
              </div>
              <div>
                <div className="font-mono text-xs text-muted">{selected.id}</div>
                <div className="font-semibold">{selected.customer}</div>
              </div>
              <span className={`ml-auto chip ${
                selected.status === 'Chờ duyệt' ? 'chip-warning' :
                selected.status === 'Đã duyệt' ? 'chip-accent' :
                selected.status === 'Đã giao' ? 'chip-success' :
                'chip-danger'
              }`}>{selected.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3"><div className="text-xs text-muted">Tổng tiền</div><div className="font-semibold text-lg">{formatVND(selected.total)}</div></div>
              <div className="card p-3"><div className="text-xs text-muted">Ngày đặt</div><div className="font-semibold text-lg">{selected.date}</div></div>
            </div>
            <div>
              <div className="text-xs text-muted uppercase tracking-wider mb-2">Sản phẩm</div>
              <div className="card divide-y divide-border">
                {['Áo polo nam M', 'Quần kaki 32', 'Giày sneaker 41'].map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <div className="w-8 h-8 rounded bg-panel-2 border border-border"></div>
                    <div className="flex-1 text-sm">{p}</div>
                    <div className="text-xs text-muted">× {[2, 1, 1][i]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted uppercase tracking-wider mb-2">Hoạt động</div>
              <div className="space-y-2 text-sm">
                <div className="flex gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0"></span><div><div>Tạo bởi <b>Anh Đức</b></div><div className="text-xs text-muted">{selected.date} · 09:42</div></div></div>
                <div className="flex gap-2"><span className="w-1.5 h-1.5 rounded-full bg-warning mt-2 shrink-0"></span><div><div>Workflow <b>Duyệt đơn &gt; 50tr</b> đang chờ</div><div className="text-xs text-muted">Chờ Sếp Hùng phê duyệt</div></div></div>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <FloatingAgentBtn onClick={onOpenAgent} />
    </div>
  );
};

// ---------- Dashboard (with mobile-friendly grid) ----------
const DashboardConsumer = ({ onOpenAgent }) => {
  const kpis = [
    { label: 'Doanh thu', value: '1,82 tỷ ₫', delta: '+12%', sub: 'so với tháng trước' },
    { label: 'Đơn hàng', value: '142', delta: '+8%', sub: '12 chờ duyệt' },
    { label: 'KH mới', value: '38', delta: '+22%', sub: 'tuần này' },
    { label: 'Tồn kho', value: '4,2k SKU', delta: '−3%', neg: true, sub: '3 SKU sắp hết' },
  ];
  return (
    <div className="overflow-y-auto h-full" data-screen-label="Consumer · Dashboard">
      <div className="max-w-[1280px] mx-auto p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="text-xs text-muted">Trang chủ</div>
            <h1 className="text-2xl font-semibold tracking-tight">Bảng điều khiển kinh doanh</h1>
            <div className="text-sm text-muted mt-1">Tháng 5/2026 · cập nhật 2 phút trước</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" icon={<I.Calendar size={13} />}>Tháng 5/2026</Button>
            <Button variant="primary" icon={<I.Sparkles size={13} />} onClick={onOpenAgent}>Hỏi insight</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {kpis.map((k) => (
            <div key={k.label} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted">{k.label}</div>
                <span className={`text-xs font-semibold ${k.neg ? 'text-danger' : 'text-success'}`}>{k.delta}</span>
              </div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
              <div className="text-xs text-muted">{k.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-3 mb-4">
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-baseline justify-between mb-2">
              <div className="font-semibold">Doanh thu theo tuần</div>
              <div className="flex gap-1">
                <span className="chip chip-accent">Doanh thu</span>
                <span className="chip">Mục tiêu</span>
              </div>
            </div>
            <div className="h-[240px]"><MiniChart /></div>
          </div>
          <div className="card p-4">
            <div className="font-semibold mb-2">Đơn cần duyệt</div>
            <div className="divide-y divide-border -mx-4">
              {ORDER_ROWS.filter((r) => r.status === 'Chờ duyệt').map((r) => (
                <div key={r.id} className="px-4 py-2.5 hover:bg-hover/30 cursor-pointer">
                  <div className="text-xs font-mono text-muted">{r.id}</div>
                  <div className="text-sm truncate">{r.customer}</div>
                  <div className="text-sm font-semibold text-accent">{formatVND(r.total)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="font-semibold">Đơn hàng gần đây</div>
            <Button variant="ghost" size="sm">Xem tất cả</Button>
          </div>
          <MiniTable />
        </div>
      </div>
      <FloatingAgentBtn onClick={onOpenAgent} />
    </div>
  );
};

const CustomersConsumer = ({ onOpenAgent }) => {
  return (
    <div className="overflow-y-auto h-full" data-screen-label="Consumer · Khách hàng">
      <div className="max-w-[1280px] mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-1">Danh sách khách hàng</h1>
        <p className="text-sm text-muted mb-4">1.204 KH · 86 VIP · 38 mới tuần này</p>
        <div className="grid md:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card p-4 hover:border-hover cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
                     style={{ background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 80% 55%), hsl(${(i * 47 + 60) % 360} 80% 65%))` }}>
                  {['MP', 'TH', 'NA', 'TB', 'SM', 'LQ', 'PL', 'HL', 'VN'][i]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {['Công ty TNHH Minh Phúc','Cửa hàng Thiên Hương','Nguyễn Văn An','Trần Thị Bích','CP Sao Mai','Lê Quang Huy','Phạm Thuỳ Linh','TNHH Hoàng Long','Văn Nam'][i]}
                  </div>
                  <div className="text-xs text-muted">KH-{1000 + i} · {['VIP','Doanh nghiệp','Cá nhân','Cá nhân','VIP','Cá nhân','Doanh nghiệp','VIP','Cá nhân'][i]}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-bg-soft border border-border rounded p-2"><div className="text-muted">Lifetime</div><div className="font-mono">{formatVND([84_500_000, 12_300_000, 2_450_000, 6_780_000, 145_200_000, 980_000, 32_400_000, 56_900_000, 4_400_000][i])}</div></div>
                <div className="bg-bg-soft border border-border rounded p-2"><div className="text-muted">Đơn</div><div className="font-mono">{[12,5,2,4,28,1,8,14,3][i]}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <FloatingAgentBtn onClick={onOpenAgent} />
    </div>
  );
};

const InventoryConsumer = ({ onOpenAgent }) => {
  const cols = [
    { name: 'Chờ duyệt', items: [{ code: 'PN-201', title: 'Nhập 200 áo polo', who: 'Anh Đức' }, { code: 'PX-099', title: 'Xuất kho ĐN', who: 'Chị Linh' }] },
    { name: 'Đang xử lý', items: [{ code: 'PN-200', title: 'Nhập giày thể thao', who: 'Anh Đức' }] },
    { name: 'Đã hoàn tất', items: [{ code: 'PX-098', title: 'Xuất 50 quần kaki', who: 'Chị Linh' }, { code: 'PN-199', title: 'Nhập phụ kiện', who: 'Anh Đức' }] },
    { name: 'Cảnh báo', items: [{ code: 'SKU-882', title: 'Áo polo M sắp hết', who: 'auto' }] },
  ];
  return (
    <div className="overflow-y-auto h-full" data-screen-label="Consumer · Kho">
      <div className="max-w-[1380px] mx-auto p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-2xl font-semibold">Kiểm kê kho</h1>
          <Button variant="primary" icon={<I.Plus size={14} />}>Phiếu mới</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {cols.map((c) => (
            <div key={c.name} className="bg-bg-soft border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2.5">
                <div className="font-semibold text-sm">{c.name}</div>
                <span className="chip" style={{ height: 18, fontSize: 10 }}>{c.items.length}</span>
              </div>
              <div className="space-y-2">
                {c.items.map((it) => (
                  <div key={it.code} className="card p-3 hover:border-hover cursor-pointer">
                    <div className="text-[11px] font-mono text-muted">{it.code}</div>
                    <div className="font-medium text-sm mt-0.5">{it.title}</div>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-muted">
                      <span>{it.who}</span>
                      <span>hôm nay</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <FloatingAgentBtn onClick={onOpenAgent} />
    </div>
  );
};

// ---------- Sếp mobile view (special viewport) ----------
const MobileDashboard = ({ onClose, onOpenAgent }) => (
  <div className="fixed inset-0 z-[850] bg-black/70 flex items-center justify-center p-6"
       onClick={onClose} data-screen-label="Mobile · Sếp Dashboard">
    <div className="bg-bg rounded-[36px] border-4 border-panel-2 shadow-2xl overflow-hidden"
         style={{ width: 380, height: 760 }}
         onClick={(e) => e.stopPropagation()}>
      <div className="h-7 bg-panel-2 flex items-center justify-center text-[10px] font-mono text-muted">
        9:41 ●●●● Mobile (S\u1ebfp)
      </div>
      <div className="p-4 overflow-y-auto h-[calc(100%-28px)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-muted">Chào sếp Hùng</div>
            <div className="text-lg font-semibold">Tổng quan hôm nay</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-panel-2 border border-border flex items-center justify-center">
            <I.X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label: 'Doanh thu', value: '1,82 tỷ', delta: '+12%' },
            { label: 'Đơn mới', value: '24', delta: '+5' },
            { label: 'Chờ duyệt', value: '8', delta: '!', warn: true },
            { label: 'Tồn thấp', value: '3 SKU', delta: '⚠', warn: true },
          ].map((k) => (
            <div key={k.label} className="card p-3">
              <div className="text-[11px] text-muted">{k.label}</div>
              <div className="text-lg font-semibold mt-0.5">{k.value}</div>
              <div className={`text-[10px] ${k.warn ? 'text-warning' : 'text-success'}`}>{k.delta}</div>
            </div>
          ))}
        </div>
        <div className="card p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm">Doanh thu 7 ngày</div>
            <span className="text-xs text-success">+12%</span>
          </div>
          <div className="h-[110px]"><MiniChart /></div>
        </div>
        <div className="text-xs text-muted uppercase tracking-wider mb-1 mt-3">Chờ duyệt</div>
        <div className="card divide-y divide-border">
          {ORDER_ROWS.filter((r) => r.status === 'Chờ duyệt').map((r) => (
            <div key={r.id} className="p-3">
              <div className="font-mono text-[10px] text-muted">{r.id}</div>
              <div className="text-sm truncate">{r.customer}</div>
              <div className="flex items-center justify-between mt-1">
                <div className="text-accent font-semibold">{formatVND(r.total)}</div>
                <div className="flex gap-1">
                  <button className="btn btn-default btn-sm">Từ chối</button>
                  <button className="btn btn-primary btn-sm">Duyệt</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onOpenAgent}
                className="mt-4 w-full h-11 rounded-lg flex items-center justify-center gap-2 text-white font-medium"
                style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))' }}>
          <I.Sparkles size={14} /> Hỏi trợ lý ERP
        </button>
      </div>
    </div>
  </div>
);

Object.assign(window, { ConsumerPage, MobileDashboard });
