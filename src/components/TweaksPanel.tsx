import { I } from "@/components/Icons";
import { Button, Switch } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { type AccentColor, type Density, type Theme, useUI } from "@/stores/ui";

const CHANGED_CELL_PRESETS: Array<{ hex: string; label: string }> = [
  { hex: "#fdb105", label: "Hổ phách" },
  { hex: "#22c55e", label: "Xanh lá" },
  { hex: "#3b82f6", label: "Xanh dương" },
  { hex: "#ec4899", label: "Hồng" },
  { hex: "#a855f7", label: "Tím" },
];

const ACCENTS: Array<{ id: AccentColor; hex: string; label: string }> = [
  { id: "violet", hex: "#7c5cff", label: "Violet" },
  { id: "cyan", hex: "#00d4ff", label: "Cyan" },
  { id: "green", hex: "#22c55e", label: "Green" },
  { id: "amber", hex: "#ff9933", label: "Amber" },
];

export function TweaksPanel() {
  const {
    tweaksOpen,
    setTweaksOpen,
    theme,
    setTheme,
    accent,
    setAccent,
    density,
    setDensity,
    sidebarCollapsed,
    setSidebarCollapsed,
    inspectorVisible,
    setInspectorVisible,
    setAgentOpen,
    setCmdOpen,
  } = useUI();
  const changedCellBg = usePreferences((s) => s.prefs.changedCellBg ?? "#fdb105");
  const savePrefs = usePreferences((s) => s.save);
  const isMobile = useIsMobile();

  if (!tweaksOpen) return null;

  return (
    <>
      {/* Backdrop click outside */}
      <div className="fixed inset-0 z-699" onClick={() => setTweaksOpen(false)} />
      <aside
        className={cn(
          "fixed top-14 z-700 panel rounded-lg shadow-2xl flex flex-col max-h-[calc(100vh-80px)] overflow-hidden",
          isMobile ? "inset-x-2 w-auto" : "right-4 w-[300px]",
        )}
      >
        <div className="h-10 px-3 flex items-center justify-between border-b border-border shrink-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            <I.Wand size={14} className="text-accent" />
            Tweaks
          </div>
          <button
            type="button"
            onClick={() => setTweaksOpen(false)}
            className="w-6 h-6 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted"
          >
            <I.X size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-sm">
          <Section label="Theme">
            <Radio
              value={theme}
              options={[
                { id: "dark", label: "Dark", icon: <I.Moon size={13} /> },
                { id: "light", label: "Light", icon: <I.Sun size={13} /> },
              ]}
              onChange={(v) => setTheme(v as Theme)}
            />
          </Section>

          <Section label="Accent">
            <div className="grid grid-cols-4 gap-2">
              {ACCENTS.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-md border transition-all",
                    accent === a.id ? "border-text" : "border-border hover:border-hover",
                  )}
                  title={a.label}
                >
                  <span className="w-6 h-6 rounded-full" style={{ background: a.hex }} />
                  <span className="text-[10px]">{a.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section label="Density">
            <Radio
              value={density}
              options={[
                { id: "comfortable", label: "Comfort" },
                { id: "compact", label: "Compact" },
              ]}
              onChange={(v) => setDensity(v as Density)}
            />
          </Section>

          <Section label="O thay doi">
            <div className="flex items-center gap-1.5 flex-wrap">
              {CHANGED_CELL_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.hex}
                  onClick={() => savePrefs({ changedCellBg: p.hex })}
                  className={cn(
                    "w-7 h-7 rounded-md border-2 transition-all",
                    changedCellBg === p.hex
                      ? "border-text scale-110"
                      : "border-transparent hover:border-border",
                  )}
                  style={{ background: p.hex }}
                  title={p.label}
                />
              ))}
              {/* Custom color picker */}
              <label
                className="w-7 h-7 rounded-md border-2 border-border hover:border-text cursor-pointer flex items-center justify-center overflow-hidden transition-all"
                title="Tùy chỉnh màu"
                style={
                  !CHANGED_CELL_PRESETS.some((p) => p.hex === changedCellBg)
                    ? { borderColor: changedCellBg, background: changedCellBg }
                    : undefined
                }
              >
                <I.Pipette
                  size={12}
                  className="text-white mix-blend-difference pointer-events-none"
                />
                <input
                  type="color"
                  className="absolute opacity-0 w-0 h-0"
                  value={changedCellBg}
                  onChange={(e) => savePrefs({ changedCellBg: e.target.value })}
                />
              </label>
              {/* Xem trước */}
              <span
                className="ml-1 flex-1 h-7 rounded-md text-[10px] flex items-center justify-center text-text/60"
                style={{ backgroundColor: `rgba(${hexToRgb(changedCellBg)},0.22)` }}
              >
                ABC
              </span>
            </div>
          </Section>

          <Section label="Layout">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>Sidebar collapsed</span>
                <Switch checked={sidebarCollapsed} onChange={setSidebarCollapsed} />
              </div>
              <div className="flex items-center justify-between">
                <span>Inspector visible</span>
                <Switch checked={inspectorVisible} onChange={setInspectorVisible} />
              </div>
            </div>
          </Section>

          <Section label="Demo">
            <div className="space-y-1.5">
              <Button
                variant="default"
                size="sm"
                className="w-full justify-center"
                icon={<I.Sparkles size={13} />}
                onClick={() => {
                  setAgentOpen(true);
                  setTweaksOpen(false);
                }}
              >
                Open Agent
              </Button>
              <Button
                variant="default"
                size="sm"
                className="w-full justify-center"
                icon={<I.Command size={13} />}
                onClick={() => {
                  setCmdOpen(true);
                  setTweaksOpen(false);
                }}
              >
                Command Palette
              </Button>
            </div>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

interface RadioProps {
  value: string;
  options: Array<{ id: string; label: string; icon?: React.ReactNode }>;
  onChange: (v: string) => void;
}
function Radio({ value, options, onChange }: RadioProps) {
  return (
    <div className="inline-flex bg-bg-soft border border-border rounded-md p-0.5 w-full">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 px-2 py-1 rounded-sm text-xs flex items-center justify-center gap-1.5 transition-colors",
            value === opt.id
              ? "bg-panel-2 text-text shadow-[0_1px_0_hsl(var(--border))]"
              : "text-muted hover:text-text",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Number.isNaN(r) ? "253,177,5" : `${r},${g},${b}`;
}
