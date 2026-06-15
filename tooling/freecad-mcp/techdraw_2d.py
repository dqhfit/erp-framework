# -*- coding: utf-8 -*-
# techdraw_2d.py — Sinh bản vẽ 2D dạng SVG HEADLESS (không cần GUI/xvfb).
#
# Cách: dùng TechDraw.project(shape, direction) — hàm TÍNH TOÁN (HLR) trả
# các nhóm cạnh chiếu lên mặt phẳng vuông góc direction, KHÔNG đụng
# QGraphics/GUI (khác hẳn export PDF của TechDraw page vốn cần Qt). Sau đó
# rời rạc hoá từng cạnh thành polyline rồi ghép SVG thủ công + ghi kích thước.
#
# ⚠ ĐÂY LÀ PHẦN CẦN VALIDATE TRƯỚC trên FreeCAD thật (xem Risk #1 của plan):
# tên/API TechDraw.project có thể đổi giữa các bản FreeCAD. Có fallback sang
# Drawing.projectToSVG (workbench cũ) nếu còn.
import FreeCAD as App
import Part  # noqa: F401


def _edges_to_polylines(comp, deflection=0.3):
    """Compound/cạnh → list polyline [(x,y),...] (lấy X,Y của mặt phẳng chiếu)."""
    polylines = []
    edges = getattr(comp, "Edges", None) or []
    for e in edges:
        pts = None
        for kwargs in ({"Deflection": deflection}, {"Number": 2}):
            try:
                pts = e.discretize(**kwargs)
                break
            except Exception:
                continue
        if not pts:
            continue
        polylines.append([(float(p.x), float(p.y)) for p in pts])
    return polylines


def _project(shape, direction):
    """Chiếu HLR → polyline cạnh THẤY (visible). Headless."""
    import TechDraw

    res = TechDraw.project(shape, direction)
    # res[0] = visible sharp edges (compound). Một số bản trả nhiều nhóm.
    visible = res[0] if isinstance(res, (tuple, list)) and res else res
    return _edges_to_polylines(visible)


def _bbox(polylines):
    xs = [x for pl in polylines for (x, _) in pl]
    ys = [y for pl in polylines for (_, y) in pl]
    if not xs:
        return (0, 0, 0, 0)
    return (min(xs), min(ys), max(xs), max(ys))


def _emit_view(polylines, ox, oy, miny, maxy, color="#111"):
    """Render 1 view tại offset (ox,oy). Lật trục Y (SVG y xuôi xuống)."""
    out = []
    for pl in polylines:
        pts = " ".join(f"{ox + x:.2f},{oy + (maxy - y):.2f}" for (x, y) in pl)
        out.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="1"/>')
    return "\n".join(out), (miny, maxy)


def build_svg(shape, params):
    """Dựng SVG nhiều hình chiếu (đứng / bằng / cạnh) + khung tên + kích thước."""
    W = float(params.get("W", 600))
    D = float(params.get("D", 400))
    H = float(params.get("H", 720))
    masp = str(params.get("masp", ""))

    # 3 hướng chiếu chuẩn.
    views = []
    for label, direction in (
        ("Hình chiếu đứng (Front)", App.Vector(0, -1, 0)),
        ("Hình chiếu bằng (Top)", App.Vector(0, 0, 1)),
        ("Hình chiếu cạnh (Side)", App.Vector(1, 0, 0)),
    ):
        try:
            pls = _project(shape, direction)
        except Exception as e:  # 1 view lỗi không làm hỏng cả bản vẽ.
            print("project fail (%s): %s" % (label, e))
            pls = []
        views.append((label, pls))

    margin = 40
    gap = 60
    parts = []
    cursor_x = margin
    max_h = 0
    for label, pls in views:
        if not pls:
            continue
        minx, miny, maxx, maxy = _bbox(pls)
        w = maxx - minx
        h = maxy - miny
        # Dịch về gốc (0,0) trước khi đặt offset.
        shifted = [[(x - minx, y - miny) for (x, y) in pl] for pl in pls]
        svg_view, _ = _emit_view(shifted, cursor_x, margin + 20, 0, h)
        parts.append(f'<text x="{cursor_x:.0f}" y="{margin + 12:.0f}" font-size="12">{label}</text>')
        parts.append(svg_view)
        cursor_x += w + gap
        max_h = max(max_h, h)

    total_w = max(cursor_x + margin, 400)
    total_h = margin + 20 + max_h + 80

    # Khung tên + kích thước tổng (text — đủ cho PoC; dimension đường nét sau).
    info_y = margin + 20 + max_h + 30
    parts.append(
        f'<text x="{margin}" y="{info_y:.0f}" font-size="13" font-weight="bold">'
        f"Mã SP: {masp}  —  KT (mm): {W:.0f} (R) x {D:.0f} (S) x {H:.0f} (C)</text>"
    )
    body = "\n".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w:.0f}" '
        f'height="{total_h:.0f}" viewBox="0 0 {total_w:.0f} {total_h:.0f}">\n'
        f'<rect x="0" y="0" width="{total_w:.0f}" height="{total_h:.0f}" '
        f'fill="white" stroke="#888"/>\n{body}\n</svg>'
    )
