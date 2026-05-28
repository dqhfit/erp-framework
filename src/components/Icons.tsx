import type { ReactNode, SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
}

const Icon = ({ size = 16, children, className = "", strokeWidth = 1.75, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`icon ${className}`}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

type IP = Omit<IconProps, "children">;

export const I = {
  Bolt: (p: IP) => (
    <Icon {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  ),
  Home: (p: IP) => (
    <Icon {...p}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
    </Icon>
  ),
  Database: (p: IP) => (
    <Icon {...p}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Icon>
  ),
  Layout: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </Icon>
  ),
  Workflow: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 6h6a3 3 0 0 1 3 3v6" />
    </Icon>
  ),
  Bot: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M8 14v.01M16 14v.01M12 4v4M9 4h6" />
    </Icon>
  ),
  Settings: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Icon>
  ),
  Search: (p: IP) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  ),
  Plus: (p: IP) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  Minus: (p: IP) => (
    <Icon {...p}>
      <path d="M5 12h14" />
    </Icon>
  ),
  X: (p: IP) => (
    <Icon {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  ),
  Check: (p: IP) => (
    <Icon {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  Columns2: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </Icon>
  ),
  ChevronDown: (p: IP) => (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  ),
  ChevronRight: (p: IP) => (
    <Icon {...p}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  ),
  ChevronLeft: (p: IP) => (
    <Icon {...p}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  ),
  ChevronUp: (p: IP) => (
    <Icon {...p}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  ),
  ChevronsUpDown: (p: IP) => (
    <Icon {...p}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </Icon>
  ),
  Sun: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  ),
  Moon: (p: IP) => (
    <Icon {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </Icon>
  ),
  Save: (p: IP) => (
    <Icon {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </Icon>
  ),
  Undo: (p: IP) => (
    <Icon {...p}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 13" />
    </Icon>
  ),
  Redo: (p: IP) => (
    <Icon {...p}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 13" />
    </Icon>
  ),
  Play: (p: IP) => (
    <Icon {...p}>
      <path d="m6 4 14 8-14 8V4Z" />
    </Icon>
  ),
  Eye: (p: IP) => (
    <Icon {...p}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  EyeOff: (p: IP) => (
    <Icon {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M10.73 10.73a3 3 0 0 0 4.17 4.31" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </Icon>
  ),
  Edit: (p: IP) => (
    <Icon {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </Icon>
  ),
  Trash: (p: IP) => (
    <Icon {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </Icon>
  ),
  Copy: (p: IP) => (
    <Icon {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  ),
  More: (p: IP) => (
    <Icon {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Icon>
  ),
  Grip: (p: IP) => (
    <Icon {...p}>
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="19" r="1" />
    </Icon>
  ),
  Send: (p: IP) => (
    <Icon {...p}>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </Icon>
  ),
  Mic: (p: IP) => (
    <Icon {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10a7 7 0 0 1-14 0M12 19v3" />
    </Icon>
  ),
  User: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  ),
  Users: (p: IP) => (
    <Icon {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <circle cx="17" cy="7" r="3" />
      <path d="M22 19a5 5 0 0 0-6-4.9" />
    </Icon>
  ),
  Sparkles: (p: IP) => (
    <Icon {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </Icon>
  ),
  Zap: (p: IP) => (
    <Icon {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  ),
  Type: (p: IP) => (
    <Icon {...p}>
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </Icon>
  ),
  Hash: (p: IP) => (
    <Icon {...p}>
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </Icon>
  ),
  Calendar: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  ),
  Clock: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Icon>
  ),
  CheckSq: (p: IP) => (
    <Icon {...p}>
      <path d="m9 11 3 3 8-8" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Icon>
  ),
  List: (p: IP) => (
    <Icon {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Icon>
  ),
  Link: (p: IP) => (
    <Icon {...p}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11 6" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L13 18" />
    </Icon>
  ),
  ExternalLink: (p: IP) => (
    <Icon {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  ),
  Key: (p: IP) => (
    <Icon {...p}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </Icon>
  ),
  File: (p: IP) => (
    <Icon {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Icon>
  ),
  Image: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </Icon>
  ),
  Mail: (p: IP) => (
    <Icon {...p}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </Icon>
  ),
  Phone: (p: IP) => (
    <Icon {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 13 13 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 13 13 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
    </Icon>
  ),
  MapPin: (p: IP) => (
    <Icon {...p}>
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Icon>
  ),
  ToggleR: (p: IP) => (
    <Icon {...p}>
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none" />
    </Icon>
  ),
  DollarSign: (p: IP) => (
    <Icon {...p}>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" />
    </Icon>
  ),
  PieChart: (p: IP) => (
    <Icon {...p}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10Z" />
    </Icon>
  ),
  BarChart: (p: IP) => (
    <Icon {...p}>
      <path d="M3 3v18h18" />
      <rect x="7" y="13" width="3" height="5" />
      <rect x="12" y="9" width="3" height="9" />
      <rect x="17" y="5" width="3" height="13" />
    </Icon>
  ),
  Activity: (p: IP) => (
    <Icon {...p}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Icon>
  ),
  Filter: (p: IP) => (
    <Icon {...p}>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" />
    </Icon>
  ),
  Layers: (p: IP) => (
    <Icon {...p}>
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </Icon>
  ),
  Kanban: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="6" height="18" rx="1" />
      <rect x="11" y="3" width="6" height="12" rx="1" />
      <rect x="19" y="3" width="2" height="8" rx="1" />
    </Icon>
  ),
  Table: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </Icon>
  ),
  PanelLeft: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </Icon>
  ),
  PanelRight: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </Icon>
  ),
  Power: (p: IP) => (
    <Icon {...p}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
    </Icon>
  ),
  Server: (p: IP) => (
    <Icon {...p}>
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <path d="M6 7h.01M6 17h.01" />
    </Icon>
  ),
  GitBranch: (p: IP) => (
    <Icon {...p}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M6 12h7a3 3 0 0 0 3-3V7" />
    </Icon>
  ),
  Bell: (p: IP) => (
    <Icon {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Icon>
  ),
  HelpCircle: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9.1a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </Icon>
  ),
  ArrowRight: (p: IP) => (
    <Icon {...p}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </Icon>
  ),
  Tag: (p: IP) => (
    <Icon {...p}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7" cy="7" r="1.5" />
    </Icon>
  ),
  Package: (p: IP) => (
    <Icon {...p}>
      <path d="M16.5 9.4 7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
    </Icon>
  ),
  Warehouse: (p: IP) => (
    <Icon {...p}>
      <path d="M22 8.35V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35a2 2 0 0 1 1.26-1.86l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
      <path d="M6 18V9h12v9M6 13h12" />
    </Icon>
  ),
  Cart: (p: IP) => (
    <Icon {...p}>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </Icon>
  ),
  Briefcase: (p: IP) => (
    <Icon {...p}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Icon>
  ),
  TrendUp: (p: IP) => (
    <Icon {...p}>
      <path d="m22 7-9 9-5-5L1 18" />
      <path d="M16 7h6v6" />
    </Icon>
  ),
  AlertCircle: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </Icon>
  ),
  Loader: (p: IP) => (
    <Icon {...p}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </Icon>
  ),
  Command: (p: IP) => (
    <Icon {...p}>
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
    </Icon>
  ),
  Wand: (p: IP) => (
    <Icon {...p}>
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h0M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
    </Icon>
  ),
  Folder: (p: IP) => (
    <Icon {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Icon>
  ),
  Star: (p: IP) => (
    <Icon {...p}>
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
    </Icon>
  ),
  Lock: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  ),
  Unlock: (p: IP) => (
    <Icon {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </Icon>
  ),
  Terminal: (p: IP) => (
    <Icon {...p}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </Icon>
  ),
  LogOut: (p: IP) => (
    <Icon {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Icon>
  ),
  Globe: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Icon>
  ),
  RefreshCw: (p: IP) => (
    <Icon {...p}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Icon>
  ),
  Ban: (p: IP) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </Icon>
  ),
  Toolbar: (p: IP) => (
    <Icon {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <rect x="5" y="9" width="4" height="6" rx="1" />
      <rect x="11" y="9" width="4" height="6" rx="1" />
      <rect x="17" y="9" width="2" height="6" rx="1" />
    </Icon>
  ),
};

export { Icon };
