import { I } from "@/components/Icons";
import { Button, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import { type AccentColor, type Density, type Theme, useUI } from "@/stores/ui";

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

  if (!tweaksOpen) return null;

  return (
    <>
      {/* Backdrop click outside */}
      <div className="fixed inset-0 z-699" onClick={() => setTweaksOpen(false)} />
      <aside className="fixed top-14 right-4 z-700 w-[300px] panel rounded-lg shadow-2xl flex flex-col max-h-[calc(100vh-80px)] overflow-hidden">
        <div className="h-10 px-3 flex items-center justify-between border-b border-border shrink-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            <I.Wand size={14} className="text-accent" />
            Tweaks
          </div>
          <button
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
