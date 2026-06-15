# FreeCAD MCP sidecar (provider 1) — headless FreeCADCmd + HTTP JSON-RPC shim.
# Build context = repo root (giống Dockerfile.server):
#   docker compose -f docker/docker-compose.yml build freecad
#
# Lưu ý: gói `freecad` của apt rất lớn (~1.5GB) → build/khởi động chậm
# (Risk #3 của plan). KHÔNG cài xvfb cho PoC: bản vẽ 2D sinh bằng projection
# headless (TechDraw.project), không qua TechDraw page (vốn cần Qt GUI).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends freecad python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY tooling/freecad-mcp/ /app/

ENV PORT=8920
EXPOSE 8920

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8920/health').status==200 else 1)" || exit 1

CMD ["python3", "/app/server.py"]
