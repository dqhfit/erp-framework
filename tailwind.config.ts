import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system","BlinkMacSystemFont","Segoe UI","Roboto","Helvetica Neue","Arial","sans-serif"],
        mono: ["ui-monospace","SFMono-Regular","Menlo","Consolas","monospace"],
      },
      fontSize: {
        xs: ["11px", "16px"],
        sm: ["13px", "18px"],
        base: ["14px", "20px"],
        lg: ["16px", "22px"],
        xl: ["18px", "26px"],
        "2xl": ["22px", "30px"],
      },
      colors: {
        bg: "hsl(var(--bg))",
        "bg-soft": "hsl(var(--bg-soft))",
        panel: "hsl(var(--panel))",
        "panel-2": "hsl(var(--panel-2))",
        hover: "hsl(var(--hover))",
        border: "hsl(var(--border))",
        text: "hsl(var(--text))",
        muted: "hsl(var(--muted))",
        accent: "hsl(var(--accent))",
        "accent-2": "hsl(var(--accent-2))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
      },
    },
  },
  plugins: [],
} satisfies Config;
