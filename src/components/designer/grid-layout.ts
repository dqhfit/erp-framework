/* Grid-layout helpers cho Split panel (banded grid): tạo/migrate/thêm-bớt
   cột-hàng + merge/split cell. Thuần (không React/UI). Tách từ PageDesigner.tsx. */
import type { ActionConfig } from "@/types/page";

type ActionBarItem = { id: string } & ActionConfig;

export type SplitGridCell = {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  kind?: string;
  entity?: string;
  dataSourceId?: string;
  title?: string;
  linkField?: string;
  fields?: string[] | null;
  columnLabels?: Record<string, string>;
  columnGroups?: unknown[];
  serverPaging?: boolean;
  editable?: boolean;
  selectable?: boolean;
  batchEdit?: boolean;
  excelMode?: boolean;
  multiSelect?: boolean;
  addRowAtEnd?: boolean;
  addRowPos?: string;
  loadGate?: string;
  rowLimit?: number;
  pageSize?: number;
  defaultSort?: { field: string; dir: "asc" | "desc" };
  embeddedActions?: ActionBarItem[];
  rowActionsBuiltin?: boolean;
  rowActionsHidden?: string[];
  rowActionsStyle?: "inline" | "popover";
  chartKind?: string;
  groupBy?: string;
  valueField?: string;
};

export type SplitGridConfig = {
  cols: number;
  rows: number;
  colFr?: number[];
  rowFr?: number[];
  cells: SplitGridCell[];
};

export function isGridConfig(cfg: Record<string, unknown>): cfg is SplitGridConfig {
  return Array.isArray(cfg.cells);
}

export function cellAt(
  cells: SplitGridCell[],
  col: number,
  row: number,
): SplitGridCell | undefined {
  return cells.find(
    (c) => col >= c.col && col < c.col + c.colSpan && row >= c.row && row < c.row + c.rowSpan,
  );
}

export function newCell(col: number, row: number): SplitGridCell {
  return {
    id: `r${row}c${col}_${Math.random().toString(36).slice(2, 6)}`,
    col,
    row,
    colSpan: 1,
    rowSpan: 1,
  };
}

export function defaultGrid(cols: number, rows: number): SplitGridConfig {
  const cells: SplitGridCell[] = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) cells.push(newCell(c, r));
  return { cols, rows, cells };
}

export function migrateToGrid(cfg: Record<string, unknown>): SplitGridConfig {
  if (isGridConfig(cfg)) return cfg as SplitGridConfig;
  const orientation = (cfg.orientation as string) ?? "h";
  const pA = (cfg.panelA as Partial<SplitGridCell>) ?? {};
  const pB = (cfg.panelB as Partial<SplitGridCell>) ?? {};
  const pC = (cfg.panelC as Partial<SplitGridCell>) ?? {};
  const pD = (cfg.panelD as Partial<SplitGridCell>) ?? {};
  if (orientation === "v") {
    return {
      cols: 1,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pB, id: "B", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      ],
    };
  }
  if (orientation === "both") {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 2 },
        { ...pB, id: "B", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pC, id: "C", col: 2, row: 2, colSpan: 1, rowSpan: 1 },
      ],
    };
  }
  if (orientation === "both2") {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pB, id: "B", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
        { ...pC, id: "C", col: 2, row: 1, colSpan: 1, rowSpan: 2 },
      ],
    };
  }
  if (orientation === "both3") {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pB, id: "B", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
        { ...pC, id: "C", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pD, id: "D", col: 2, row: 2, colSpan: 1, rowSpan: 1 },
      ],
    };
  }
  // both4: A trên (full width) / B trái dưới, C phải dưới
  if (orientation === "both4") {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 2, rowSpan: 1 },
        { ...pB, id: "B", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
        { ...pC, id: "C", col: 2, row: 2, colSpan: 1, rowSpan: 1 },
      ],
    };
  }
  // both5: A trái trên, B phải trên / C dưới (full width)
  if (orientation === "both5") {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pB, id: "B", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
        { ...pC, id: "C", col: 1, row: 2, colSpan: 2, rowSpan: 1 },
      ],
    };
  }
  return {
    cols: 2,
    rows: 1,
    cells: [
      { ...pA, id: "A", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { ...pB, id: "B", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ],
  };
}

export function addGridCol(cfg: SplitGridConfig): SplitGridConfig {
  const newCol = cfg.cols + 1;
  const extra: SplitGridCell[] = [];
  for (let r = 1; r <= cfg.rows; r++) {
    if (!cellAt(cfg.cells, newCol, r)) extra.push(newCell(newCol, r));
  }
  return { ...cfg, cols: newCol, cells: [...cfg.cells, ...extra] };
}

export function removeGridCol(cfg: SplitGridConfig): SplitGridConfig {
  if (cfg.cols <= 1) return cfg;
  const col = cfg.cols;
  const cells = cfg.cells
    .filter((c) => c.col !== col)
    .map((c) => {
      const end = c.col + c.colSpan - 1;
      if (end >= col) return { ...c, colSpan: col - c.col };
      return c;
    })
    .filter((c) => c.colSpan > 0);
  return { ...cfg, cols: col - 1, cells };
}

export function addGridRow(cfg: SplitGridConfig): SplitGridConfig {
  const newRow = cfg.rows + 1;
  const extra: SplitGridCell[] = [];
  for (let c = 1; c <= cfg.cols; c++) {
    if (!cellAt(cfg.cells, c, newRow)) extra.push(newCell(c, newRow));
  }
  return { ...cfg, rows: newRow, cells: [...cfg.cells, ...extra] };
}

export function removeGridRow(cfg: SplitGridConfig): SplitGridConfig {
  if (cfg.rows <= 1) return cfg;
  const row = cfg.rows;
  const cells = cfg.cells
    .filter((c) => c.row !== row)
    .map((c) => {
      const end = c.row + c.rowSpan - 1;
      if (end >= row) return { ...c, rowSpan: row - c.row };
      return c;
    })
    .filter((c) => c.rowSpan > 0);
  return { ...cfg, rows: row - 1, cells };
}

export function mergeRight(cfg: SplitGridConfig, cellId: string): SplitGridConfig {
  const cell = cfg.cells.find((c) => c.id === cellId);
  if (!cell) return cfg;
  const rightCol = cell.col + cell.colSpan;
  if (rightCol > cfg.cols) return cfg;
  const rightCell = cellAt(cfg.cells, rightCol, cell.row);
  if (!rightCell || rightCell.rowSpan !== cell.rowSpan || rightCell.col !== rightCol) return cfg;
  return {
    ...cfg,
    cells: cfg.cells
      .filter((c) => c.id !== rightCell.id)
      .map((c) => (c.id === cellId ? { ...c, colSpan: c.colSpan + rightCell.colSpan } : c)),
  };
}

export function mergeDown(cfg: SplitGridConfig, cellId: string): SplitGridConfig {
  const cell = cfg.cells.find((c) => c.id === cellId);
  if (!cell) return cfg;
  const belowRow = cell.row + cell.rowSpan;
  if (belowRow > cfg.rows) return cfg;
  const belowCell = cellAt(cfg.cells, cell.col, belowRow);
  if (!belowCell || belowCell.colSpan !== cell.colSpan || belowCell.row !== belowRow) return cfg;
  return {
    ...cfg,
    cells: cfg.cells
      .filter((c) => c.id !== belowCell.id)
      .map((c) => (c.id === cellId ? { ...c, rowSpan: c.rowSpan + belowCell.rowSpan } : c)),
  };
}

export function splitCell(cfg: SplitGridConfig, cellId: string): SplitGridConfig {
  const cell = cfg.cells.find((c) => c.id === cellId);
  if (!cell || (cell.colSpan === 1 && cell.rowSpan === 1)) return cfg;
  const newCells: SplitGridCell[] = [];
  for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
      if (r === cell.row && c === cell.col) {
        newCells.push({ ...cell, colSpan: 1, rowSpan: 1 });
      } else {
        newCells.push(newCell(c, r));
      }
    }
  }
  return { ...cfg, cells: [...cfg.cells.filter((c) => c.id !== cellId), ...newCells] };
}
