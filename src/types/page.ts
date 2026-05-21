export type ComponentType =
  | "list" | "form" | "kanban" | "gantt" | "tree"
  | "chart" | "kpi" | "card" | "html" | "iframe";

export interface PageComponent {
  id: string;
  type: ComponentType;
  x: number; y: number; w: number; h: number;
  config: Record<string, unknown>;
}
export interface PageDef {
  id: string;
  name: string;
  path: string;
  icon?: string;
  components: PageComponent[];
}
