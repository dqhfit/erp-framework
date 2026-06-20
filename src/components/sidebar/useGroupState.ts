/* Sub-menu group state cho Sidebar — gộp mục con dưới mục cha + nhớ
   trạng thái mở/đóng vào localStorage (key `sb-grp-<key>`). */
import { useState } from "react";

export interface GroupState {
  parents: Record<string, string>; // childId → parentId
  expanded: Record<string, boolean>; // parentId → open flag (missing = open)
}
const _eGs: GroupState = { parents: {}, expanded: {} };

function _loadGs(k: string): GroupState {
  try {
    const r = localStorage.getItem(`sb-grp-${k}`);
    return r ? (JSON.parse(r) as GroupState) : _eGs;
  } catch {
    return _eGs;
  }
}
function _saveGs(k: string, g: GroupState) {
  try {
    localStorage.setItem(`sb-grp-${k}`, JSON.stringify(g));
  } catch {}
}

export function useGroupState(key?: string) {
  const [gs, _set] = useState<GroupState>(() => (key ? _loadGs(key) : _eGs));
  const set = (next: GroupState) => {
    _set(next);
    if (key) _saveGs(key, next);
  };
  return {
    gs,
    nestUnder: (child: string, parent: string) =>
      set({
        parents: { ...gs.parents, [child]: parent },
        expanded: { ...gs.expanded, [parent]: true },
      }),
    unnest: (child: string) => {
      const p = { ...gs.parents };
      delete p[child];
      set({ ...gs, parents: p });
    },
    toggleExpanded: (id: string) =>
      set({ ...gs, expanded: { ...gs.expanded, [id]: !(gs.expanded[id] ?? true) } }),
  };
}
