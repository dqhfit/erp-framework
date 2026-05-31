import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

interface UndoableState<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface UndoableControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useUndoable<T>(
  initial: T,
): [T, (next: T | ((cur: T) => T)) => void, UndoableControls] {
  const [hist, setHist] = useState<UndoableState<T>>({
    past: [],
    present: initial,
    future: [],
  });

  // Ref để keyboard handler luôn gọi hàm mới nhất
  const histRef = useRef(hist);
  histRef.current = hist;

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setHist((h) => {
      const value = typeof next === "function" ? (next as (cur: T) => T)(h.present) : next;
      if (value === h.present) return h;
      return {
        past: [...h.past, h.present].slice(-MAX_HISTORY),
        present: value,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1]!;
      return {
        past: h.past.slice(0, -1),
        present: prev,
        future: [h.present, ...h.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0]!;
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
      };
    });
  }, []);

  return [
    hist.present,
    set,
    { canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, undo, redo },
  ];
}
