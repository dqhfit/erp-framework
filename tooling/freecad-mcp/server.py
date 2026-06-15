#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# server.py — FreeCAD MCP HTTP shim (JSON-RPC 2.0 over HTTP).
#
# Chạy bằng PYTHON HỆ THỐNG (chỉ stdlib — KHÔNG import FreeCAD), nên server
# luôn đứng được dù FreeCAD lỗi. Mỗi tools/call spawn `freecadcmd run_build.py`
# (subprocess) để dựng hình + xuất file rồi base64 trả về. Tách tiến trình =
# build lỗi/crash không hạ server; cô lập tài nguyên.
#
# Hợp đồng tool khớp với ERP:
#   - cad_build_panel_box(masp?, family?, params{W,D,H,thickness,hasBack,shelves}, format?)
#     → result.content[0].text = JSON {format, svg, step} (base64)
#
# Auth: header X-FreeCAD-Secret == env FREECAD_MCP_SECRET (nếu secret được đặt).
# Cổng: env PORT (mặc định 8920). FreeCADCmd: env FREECADCMD (mặc định freecadcmd).
import base64
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8920"))
SECRET = os.environ.get("FREECAD_MCP_SECRET", "")
FREECADCMD = os.environ.get("FREECADCMD", "freecadcmd")
BUILD_TIMEOUT = int(os.environ.get("FREECAD_BUILD_TIMEOUT", "180"))
HERE = os.path.dirname(os.path.abspath(__file__))
RUN_BUILD = os.path.join(HERE, "run_build.py")

TOOLS = [
    {
        "name": "cad_build_panel_box",
        "description": (
            "Dựng thùng/tủ gỗ ván chữ nhật parametric: trả model 3D STEP + "
            "bản vẽ 2D SVG. Tham số params: W,D,H (mm), thickness, hasBack, shelves."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "masp": {"type": "string"},
                "family": {"type": "string"},
                "params": {
                    "type": "object",
                    "properties": {
                        "W": {"type": "number"},
                        "D": {"type": "number"},
                        "H": {"type": "number"},
                        "thickness": {"type": "number"},
                        "hasBack": {"type": "boolean"},
                        "shelves": {"type": "integer"},
                    },
                    "required": ["W", "D", "H"],
                },
                "format": {"type": "string", "enum": ["svg"]},
            },
            "required": ["params"],
        },
    }
]


def build_panel_box(args):
    """Spawn freecadcmd run_build.py, gom file → base64."""
    with tempfile.TemporaryDirectory() as d:
        params_path = os.path.join(d, "req.json")
        out_dir = os.path.join(d, "out")
        os.makedirs(out_dir)
        with open(params_path, "w", encoding="utf-8") as f:
            json.dump(args, f)
        proc = subprocess.run(
            [FREECADCMD, RUN_BUILD, params_path, out_dir],
            capture_output=True,
            text=True,
            timeout=BUILD_TIMEOUT,
        )
        result_path = os.path.join(out_dir, "result.json")
        if not os.path.exists(result_path):
            tail = ((proc.stderr or "") + "\n" + (proc.stdout or ""))[-2000:]
            raise RuntimeError("FreeCAD build thất bại: " + tail)
        with open(result_path, "r", encoding="utf-8") as f:
            result = json.load(f)
        payload = {"format": result.get("format", "svg")}
        for key, fname in (result.get("files") or {}).items():
            p = os.path.join(out_dir, fname)
            if os.path.exists(p):
                with open(p, "rb") as fb:
                    payload[key] = base64.b64encode(fb.read()).decode("ascii")
        return payload


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send({"ok": True})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):  # noqa: N802
        if SECRET and self.headers.get("x-freecad-secret", "") != SECRET:
            self._send(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "bad secret"}},
                401,
            )
            return
        length = int(self.headers.get("content-length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw or b"{}")
        except Exception:
            self._send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            return
        rid = req.get("id")
        method = req.get("method")
        try:
            if method == "initialize":
                self._send(
                    {
                        "jsonrpc": "2.0",
                        "id": rid,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "freecad-cad", "version": "1.0.0"},
                        },
                    }
                )
            elif method == "notifications/initialized":
                self._send({}, 204)
            elif method == "ping":
                self._send({"jsonrpc": "2.0", "id": rid, "result": {}})
            elif method == "tools/list":
                self._send({"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}})
            elif method == "tools/call":
                params = req.get("params", {}) or {}
                name = params.get("name")
                args = params.get("arguments", {}) or {}
                if name != "cad_build_panel_box":
                    raise RuntimeError("tool không hỗ trợ: %s" % name)
                payload = build_panel_box(args)
                self._send(
                    {
                        "jsonrpc": "2.0",
                        "id": rid,
                        "result": {"content": [{"type": "text", "text": json.dumps(payload)}]},
                    }
                )
            else:
                self._send(
                    {
                        "jsonrpc": "2.0",
                        "id": rid,
                        "error": {"code": -32601, "message": "method không hỗ trợ: %s" % method},
                    }
                )
        except subprocess.TimeoutExpired:
            self._send(
                {"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": "FreeCAD timeout"}}
            )
        except Exception as e:
            self._send(
                {"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": str(e)}}
            )

    def log_message(self, *_a):  # tắt log mặc định (ồn).
        pass


if __name__ == "__main__":
    print("[freecad-mcp] HTTP JSON-RPC trên :%d (freecadcmd=%s)" % (PORT, FREECADCMD), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
