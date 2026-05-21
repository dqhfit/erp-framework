/* Shared UI primitives — Button, Input, Modal, Drawer, etc. */
const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;

// ----- Toast system -----
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);

const ToastHost = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...toast }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.duration || 3000);
  }, []);
  const api = useMemo(() => ({
    info: (msg) => push({ kind: 'info', msg }),
    success: (msg) => push({ kind: 'success', msg }),
    warning: (msg) => push({ kind: 'warning', msg }),
    error: (msg) => push({ kind: 'error', msg }),
  }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id}
               className={`toast-enter pointer-events-auto flex items-center gap-2 panel rounded-lg px-3 py-2 shadow-lg min-w-[240px] text-sm
                 ${t.kind === 'success' ? 'border-success/40' : t.kind === 'warning' ? 'border-warning/40' : t.kind === 'error' ? 'border-danger/40' : ''}`}>
            <span className={`w-2 h-2 rounded-full ${
              t.kind === 'success' ? 'bg-success' : t.kind === 'warning' ? 'bg-warning' : t.kind === 'error' ? 'bg-danger' : 'bg-accent-2'
            }`}></span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

// ----- Button -----
const Button = ({ variant = 'default', size = 'md', icon, children, className = '', ...rest }) => {
  const cls = `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''} ${!children ? 'btn-icon' : ''} ${className}`;
  return (
    <button className={cls} {...rest}>
      {icon}{children}
    </button>
  );
};

// ----- Modal -----
const Modal = ({ open, onClose, title, children, footer, width = 480 }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
      <div
        className="relative panel rounded-lg shadow-2xl flex flex-col max-h-[90vh]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="font-semibold text-lg">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />}></Button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-3 border-t border-border flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

// ----- Drawer (right slide) -----
const Drawer = ({ open, onClose, title, children, width = 420, footer }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[800]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40"></div>
      <div
        className="absolute top-0 right-0 h-full panel border-l border-border shadow-2xl flex flex-col"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-border h-12 shrink-0">
          <div className="font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />}></Button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="p-3 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
};

// ----- InlineEdit -----
const InlineEdit = ({ value, onChange, className = '', placeholder = '' }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <input
        autoFocus className={`inline-edit-input ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange?.(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onChange?.(draft); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <span className={`inline-edit ${className}`} onClick={() => setEditing(true)} title="Click to edit">
      {value || <span className="text-muted">{placeholder}</span>}
    </span>
  );
};

// ----- Tabs -----
const Tabs = ({ value, onChange, options }) => (
  <div className="flex border-b border-border">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`px-3 h-9 text-sm border-b-2 -mb-px transition-colors ${
          value === opt.value
            ? 'border-accent text-text'
            : 'border-transparent text-muted hover:text-text'
        }`}
      >{opt.label}</button>
    ))}
  </div>
);

// ----- FormField -----
const FormField = ({ label, hint, error, children }) => (
  <div className="space-y-1.5">
    {label && <label className="block text-xs font-semibold text-muted uppercase tracking-wide">{label}</label>}
    {children}
    {hint && !error && <div className="text-xs text-muted">{hint}</div>}
    {error && <div className="text-xs text-danger">{error}</div>}
  </div>
);

// ----- Switch -----
const Switch = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <span
      onClick={() => onChange?.(!checked)}
      className={`w-8 h-[18px] rounded-full relative transition-colors ${checked ? 'bg-accent' : 'bg-panel-2 border border-border'}`}
    >
      <span className={`absolute top-[2px] w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}></span>
    </span>
    {label && <span className="text-sm">{label}</span>}
  </label>
);

// ----- EmptyState -----
const EmptyState = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4 text-muted">
    <div className="w-12 h-12 rounded-lg bg-panel-2 border border-border flex items-center justify-center mb-3">
      {icon}
    </div>
    <div className="text-text font-semibold mb-1">{title}</div>
    {hint && <div className="text-sm max-w-sm">{hint}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

Object.assign(window, {
  Button, Modal, Drawer, InlineEdit, Tabs, FormField, Switch, EmptyState,
  ToastHost, useToast,
});
