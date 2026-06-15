/* ==========================================================
   Model3dViewer.tsx — Xem mô hình 3D (STL) của bản vẽ AI trên web.
   Tải /banvesvc/model?id=&kind=stl (mesh do FreeCAD sidecar xuất) rồi render
   bằng three.js + OrbitControls. Lazy-load (three ~tách chunk riêng) để không
   phình bundle chính. Dọn renderer/geometry/controls khi unmount.

   Lưu ý màu: chrome (header) dùng token theme; nền canvas trong suốt (alpha)
   để lộ nền panel theo theme. Màu MATERIAL của mesh là "màu dữ liệu/viewer"
   (ngoại lệ hợp lệ như Chart — xem CLAUDE.md mục 7).
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { I } from "@/components/Icons";

export default function Model3dViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let raf = 0;
    let disposed = false;
    let mesh: THREE.Mesh | null = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 1.2, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-1, -0.5, -1);
    scene.add(fill);

    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    (async () => {
      try {
        const res = await fetch(`/banvesvc/model?id=${encodeURIComponent(id)}&kind=stl`, {
          credentials: "include",
        });
        if (!res.ok) {
          setError(
            res.status === 404
              ? "Bản vẽ này chưa có mô hình 3D."
              : `Không tải được mô hình (lỗi ${res.status}).`,
          );
          setLoading(false);
          return;
        }
        const buf = await res.arrayBuffer();
        if (disposed) return;
        const geo = new STLLoader().parse(buf);
        geo.computeVertexNormals();
        geo.center();
        geo.computeBoundingSphere();
        const r = geo.boundingSphere?.radius || 100;
        const mat = new THREE.MeshStandardMaterial({
          color: 0xb0b4ba,
          metalness: 0.1,
          roughness: 0.75,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        camera.position.set(r * 1.8, r * 1.4, r * 2.2);
        camera.near = Math.max(r / 100, 0.01);
        camera.far = r * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        setLoading(false);
        resize();
        animate();
      } catch (e) {
        setError((e as Error).message || "Không đọc được mô hình.");
        setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [id]);

  const stepUrl = `/banvesvc/model?id=${encodeURIComponent(id)}&kind=step`;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border">
        <I.Box size={18} className="text-accent shrink-0" />
        <span className="text-sm font-medium flex-1">Mô hình 3D</span>
        <a
          href={stepUrl}
          className="btn-default text-xs px-2 py-1 inline-flex items-center gap-1"
          download
        >
          <I.Download size={14} /> Tải STEP
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-hover text-muted"
          aria-label="Đóng"
        >
          <I.X size={18} />
        </button>
      </div>
      <div className="relative flex-1 bg-bg-soft">
        <div ref={mountRef} className="absolute inset-0" />
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm gap-2">
            <I.Loader size={16} className="animate-spin" /> Đang tải mô hình…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm px-6 text-center">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-muted/70 pointer-events-none">
            Kéo để xoay · lăn để zoom · giữ phải để dịch
          </div>
        )}
      </div>
    </div>
  );
}
