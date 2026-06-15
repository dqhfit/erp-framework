# -*- coding: utf-8 -*-
# run_build.py — Chạy BỞI freecadcmd (có FreeCAD API). Đọc params.json → dựng
# hình → xuất STEP (3D) + SVG (bản vẽ 2D headless) vào out_dir, ghi result.json.
#   Gọi: freecadcmd run_build.py <params.json> <out_dir>
# server.py (HTTP shim) spawn lệnh này mỗi request rồi base64 các file.
import json
import os
import sys

import FreeCAD as App
import Part

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from panel_box import build_panel_box  # noqa: E402
from techdraw_2d import build_svg  # noqa: E402


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: run_build.py <params.json> <out_dir>")
    params_path, out_dir = sys.argv[1], sys.argv[2]
    with open(params_path, "r", encoding="utf-8") as f:
        req = json.load(f)
    params = req.get("params", {}) or {}
    # Cho phép truyền masp để in vào khung tên bản vẽ.
    if req.get("masp") and "masp" not in params:
        params["masp"] = req.get("masp")

    os.makedirs(out_dir, exist_ok=True)
    doc = App.newDocument("cad")
    shape = build_panel_box(params)
    obj = doc.addObject("Part::Feature", "PanelBox")
    obj.Shape = shape
    doc.recompute()

    files = {}

    # 3D STEP — luôn headless.
    step_path = os.path.join(out_dir, "model.step")
    try:
        Part.export([obj], step_path)
        files["step"] = "model.step"
    except Exception as e:
        print("STEP export fail (Part.export):", e)
        try:
            shape.exportStep(step_path)
            files["step"] = "model.step"
        except Exception as e2:
            print("STEP export fail (exportStep):", e2)

    # 3D STL — tessellate shape → mesh, để xem 3D trên web (three.js).
    # STEP là BREP, trình duyệt không đọc trực tiếp; STL là mesh universal.
    try:
        import MeshPart

        mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=1.0, AngularDeflection=0.5)
        mesh.write(os.path.join(out_dir, "model.stl"))
        files["stl"] = "model.stl"
    except Exception as e:
        print("STL export fail:", e)

    # 2D SVG — projection headless (xem techdraw_2d.py).
    try:
        svg = build_svg(shape, params)
        with open(os.path.join(out_dir, "banve.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        files["svg"] = "banve.svg"
    except Exception as e:
        print("SVG build fail:", e)

    if not files:
        raise SystemExit("Không xuất được file nào (STEP+SVG đều lỗi).")

    with open(os.path.join(out_dir, "result.json"), "w", encoding="utf-8") as f:
        json.dump({"format": "svg", "files": files}, f)
    print("OK files=%s" % ",".join(files))


main()
