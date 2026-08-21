"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { computeCenter, rebuildGroup } from "../lib/build3d";
import { clamp } from "../lib/planGeometry";

export default function Viewport3D({ rooms, stairs, wallHeight, wallColor, autoRotate }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const flagsRef = useRef({ autoRotate });
  const textureCacheRef = useRef(new Map());
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => { flagsRef.current.autoRotate = autoRotate; }, [autoRotate]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f2);
    scene.fog = new THREE.Fog(0xf0f0f2, 22, 60);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x1a1f2b, 0.95));
    const dir = new THREE.DirectionalLight(0xfff2e0, 1.0);
    dir.position.set(10, 18, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = -0.0015;
    scene.add(dir);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(300, 150, 0xa1a1aa, 0xd4d4d8);
    grid.position.y = -0.02;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const center0 = computeCenter(rooms, wallHeight);
    const orbit = {
      theta: Math.PI / 4,
      phi: 1.0,
      radius: center0.radius,
      target: new THREE.Vector3(0, center0.targetY, 0),
    };

    function updateCamera() {
      const { theta, phi, radius, target } = orbit;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    }

    let dragging = false, lastX = 0, lastY = 0;
    function onDown(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      orbit.theta -= dx * 0.006;
      orbit.phi = clamp(orbit.phi - dy * 0.006, 0.15, 1.5);
      updateCamera();
    }
    function onUp() { dragging = false; }
    function onWheel(e) {
      e.preventDefault();
      orbit.radius = clamp(orbit.radius * (1 + e.deltaY * 0.001), 3, 50);
      updateCamera();
    }

    const dom = renderer.domElement;
    dom.style.cursor = "grab";
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      // قياس بحجم صفر ممكن ياخذ لحظة عابرة (لسا الـ layout ما استقر — خصوصاً بنافذة صغيرة/غير
      // مكبّرة). استدعاء renderer.setSize بعرض أو ارتفاع صفر ممكن يكسر WebGL context بشكل دائم
      // بمتصفحات/تعريفات كرافيك معيّنة، وResizeObserver بعدها ما بيقدر يصلحه ولو رجع القياس
      // صحيح — فبنتجاهل القياس الصفري ونستنى استدعاء لاحق بحجم حقيقي
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    updateCamera();

    const animState = { progress: 0, playing: true, meshes: [] };
    let raf;
    function render() {
      raf = requestAnimationFrame(render);
      if (flagsRef.current.autoRotate && !dragging) {
        orbit.theta += 0.0028;
        updateCamera();
      }
      if (animState.playing) {
        animState.progress = Math.min(1, animState.progress + 0.025);
        animState.meshes.forEach(({ mesh, height, baseY, delay }) => {
          const local = clamp((animState.progress - delay) / (1 - delay), 0, 1);
          const eased = 1 - Math.pow(1 - local, 3);
          mesh.scale.y = Math.max(eased, 0.001);
          mesh.position.y = baseY + (height * eased) / 2;
        });
        if (animState.progress >= 1) animState.playing = false;
      }
      renderer.render(scene, camera);
    }
    render();

    stateRef.current = {
      group, orbit, updateCamera, animState, dirLight: dir,
      center: center0, defaultRadius: center0.radius,
    };

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      ro.disconnect();
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s.group) return;
    rebuildGroup(s.group, rooms, stairs, wallHeight, wallColor, s.center, s.animState, textureCacheRef.current);

    if (s.dirLight) {
      const radius = s.defaultRadius;
      s.dirLight.position.set(radius * 0.6, Math.max(14, radius * 0.9), radius * 0.45);
      const cam = s.dirLight.shadow.camera;
      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.near = 1;
      const maxWallHeight = Math.max(wallHeight, ...rooms.map((r) => r.wall_height ?? wallHeight));
      cam.far = radius * 3 + maxWallHeight * 2;
      cam.updateProjectionMatrix();
    }
  }, [rooms, stairs, wallHeight, wallColor]);

  useEffect(() => {
    if (resetKey === 0) return;
    const s = stateRef.current;
    if (!s.orbit) return;
    s.orbit.theta = Math.PI / 4;
    s.orbit.phi = 1.0;
    s.orbit.radius = s.defaultRadius;
    s.updateCamera();
  }, [resetKey]);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute top-3 right-3 text-[11px] font-mono text-slate-400 bg-slate-950/70 border border-slate-800 rounded-md px-2.5 py-1.5 pointer-events-none">
        اسحب للدوران · مرّر للتكبير
      </div>
      <button
        onClick={() => setResetKey((k) => k + 1)}
        className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs font-semibold text-slate-200 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 transition-colors"
      >
        <RotateCcw size={13} /> إعادة ضبط الكاميرا
      </button>
    </div>
  );
}
