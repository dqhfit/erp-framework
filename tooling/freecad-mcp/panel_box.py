# -*- coding: utf-8 -*-
# panel_box.py — Generator parametric họ PoC: thùng/tủ gỗ ván chữ nhật.
# Dựng carcass từ các tấm ván (2 hông, đáy, nóc, hậu tuỳ chọn, kệ tuỳ chọn).
# Chạy TRONG freecadcmd (import FreeCAD/Part). Engine-agnostic: dùng chung
# cho sidecar Docker (provider 1) lẫn addon FreeCAD local (provider 2b).
import FreeCAD as App  # noqa: F401  (freecadcmd cung cấp)
import Part


def build_panel_box(params):
    """Trả về Part.Shape (compound carcass) từ tham số (mm).

    params: { W, D, H, thickness=18, hasBack=True, shelves=0 }
    W = rộng (X), D = sâu (Y), H = cao (Z).
    """
    W = float(params.get("W", 600))
    D = float(params.get("D", 400))
    H = float(params.get("H", 720))
    t = float(params.get("thickness", 18))
    has_back = bool(params.get("hasBack", True))
    shelves = int(params.get("shelves", 0) or 0)

    if min(W, D, H) <= 0:
        raise ValueError("W/D/H phải > 0")
    if t <= 0 or t * 2 >= min(W, H):
        raise ValueError("thickness không hợp lệ so với W/H")

    solids = []
    # Đáy + nóc (full W x D, dày t).
    solids.append(Part.makeBox(W, D, t, App.Vector(0, 0, 0)))
    solids.append(Part.makeBox(W, D, t, App.Vector(0, 0, H - t)))
    # Hông trái + phải (dày t, full D x H).
    solids.append(Part.makeBox(t, D, H, App.Vector(0, 0, 0)))
    solids.append(Part.makeBox(t, D, H, App.Vector(W - t, 0, 0)))
    # Tấm hậu (mỏng, đặt sát mặt sau).
    if has_back:
        solids.append(Part.makeBox(W - 2 * t, t, H - 2 * t, App.Vector(t, D - t, t)))
    # Kệ trong (chia đều khoảng trống cao).
    if shelves > 0:
        gap = (H - 2 * t) / (shelves + 1)
        depth = D - (t if has_back else 0)
        for i in range(1, shelves + 1):
            z = t + gap * i
            solids.append(Part.makeBox(W - 2 * t, depth, t, App.Vector(t, 0, z)))

    shape = solids[0]
    for s in solids[1:]:
        shape = shape.fuse(s)
    # Gộp mặt phẳng đồng phẳng cho gọn.
    try:
        shape = shape.removeSplitter()
    except Exception:
        pass
    return shape
