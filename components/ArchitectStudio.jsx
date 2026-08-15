"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Layers, Trash2, RotateCcw, RotateCw, PlayCircle, PauseCircle, Ruler, Sparkles, X,
  MapPin, PencilRuler, Building2, FileCheck2, HardHat, ClipboardCheck, KeyRound,
  CheckCircle2, Circle, Clock3, ChevronLeft, FolderPlus, ChevronDown, ChevronUp, Plus, CalendarDays, UserRound,
  Loader2, AlertTriangle, LogOut, AppWindow, DoorOpen, Printer, Folders, Move, Armchair,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { computeCenter, rebuildGroup, DOOR_W, WIN_W, computeSharedBoundaries, sharedWallRanges, FURNITURE_KINDS, computeFloorBaseYMap, stairFootprint } from "../lib/build3d";

const ROOM_COLORS = [
  { name: "طوبي", hex: "#C7714E" },
  { name: "فيروزي", hex: "#4AC1D9" },
  { name: "بنفسجي", hex: "#8B7FD1" },
  { name: "أخضر مريمية", hex: "#5FBF7A" },
  { name: "كهرماني", hex: "#E5C158" },
  { name: "وردي", hex: "#E1637A" },
];

const WALL_COLORS = [
  { name: "أبيض دافئ", hex: "#EDE7DC" },
  { name: "رمادي بارد", hex: "#C7CDD6" },
  { name: "فحمي", hex: "#3B4454" },
];

const LAND_TYPES = ["فيلا سكنية", "شقة / سكني متعدد", "مبنى تجاري", "أرض فارغة"];

const ROOM_TYPES = ["غرفة نوم", "صالة", "مطبخ", "حمام", "مدخل", "موزع", "تواليت", "شرفة"];

const FLOOR_ORDINALS = [
  "الطابق الأرضي", "الطابق الأول", "الطابق الثاني", "الطابق الثالث", "الطابق الرابع",
  "الطابق الخامس", "الطابق السادس", "الطابق السابع", "الطابق الثامن", "الطابق التاسع",
  "الطابق العاشر", "الطابق الحادي عشر", "الطابق الثاني عشر",
];
function floorLabel(n) {
  return FLOOR_ORDINALS[n] || `الطابق ${n}`;
}
const FLOOR_CAP = 12;

const WALL_SNAP_TOLERANCE = 0.3; // بالمتر — كافي لالتقاط جدار بسماكة 0.15م بدون ما يلتقط جدار غرفة تانية غلط
const OPENING_HIT_TOLERANCE = 0.22; // بالمتر — لالتقاط النقر على علامة باب/نافذة موجودة لتحديدها

function pointSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// بيلاقي أقرب جدار (لأي غرفة) لنقطة ضغط/تمرير معيّنة، ضمن مسافة التقاط معقولة،
// وبيتأكد إنه في مجال كافي للفتحة الجديدة بلا تداخل مع فتحة موجودة أصلاً
function hitTestWalls(rooms, cx, cy, openingWidth, kind, sharedRanges, excludeOpeningId) {
  let best = null;
  rooms.forEach((r) => {
    const walls = [
      { wall: "top", x1: r.gx, y1: r.gy, x2: r.gx + r.gw, y2: r.gy, length: r.gw },
      { wall: "bottom", x1: r.gx, y1: r.gy + r.gh, x2: r.gx + r.gw, y2: r.gy + r.gh, length: r.gw },
      { wall: "left", x1: r.gx, y1: r.gy, x2: r.gx, y2: r.gy + r.gh, length: r.gh },
      { wall: "right", x1: r.gx + r.gw, y1: r.gy, x2: r.gx + r.gw, y2: r.gy + r.gh, length: r.gh },
    ];
    walls.forEach((w) => {
      const { dist, t } = pointSegDist(cx, cy, w.x1, w.y1, w.x2, w.y2);
      const rawPosition = t * w.length;
      if (kind === "window") {
        const ranges = sharedRanges?.get(`${r.id}:${w.wall}`);
        if (ranges?.some((rg) => rawPosition >= rg.start - 0.001 && rawPosition <= rg.end + 0.001)) return;
      }
      if (!best || dist < best.dist) best = { dist, roomId: r.id, wall: w.wall, length: w.length, rawPosition };
    });
  });

  if (!best || best.dist > WALL_SNAP_TOLERANCE) return null;
  if (best.length < openingWidth) return null;

  const half = openingWidth / 2;
  const position = clamp(best.rawPosition, half, best.length - half);

  const room = rooms.find((r) => r.id === best.roomId);
  const existing = (room.openings || []).filter((o) => o.wall === best.wall && o.id !== excludeOpeningId);
  const overlaps = existing.some((o) => {
    const ow = o.kind === "door" ? DOOR_W : WIN_W;
    return position - half < o.position + ow / 2 && position + half > o.position - ow / 2;
  });
  if (overlaps) return null;

  return { roomId: best.roomId, wall: best.wall, position };
}

// بيلاقي أقرب فتحة (باب/نافذة) موجودة لنقطة نقر معيّنة، لتحديدها (حذف/نقل)
function hitTestOpenings(rooms, cx, cy) {
  let best = null;
  rooms.forEach((r) => {
    (r.openings || []).forEach((o) => {
      const width = o.kind === "door" ? DOOR_W : WIN_W;
      const m = openingMarkPoints(r, o.wall, o.position, width);
      const { dist } = pointSegDist(cx, cy, m.x1, m.y1, m.x2, m.y2);
      if (!best || dist < best.dist) best = { dist, roomId: r.id, id: o.id, wall: o.wall, position: o.position, kind: o.kind };
    });
  });
  if (!best || best.dist > OPENING_HIT_TOLERANCE) return null;
  return best;
}

// بيرجع نقطتين لرسم علامة فتحة على جدار (بمساحة المخطط 2D بالمتر)
function openingMarkPoints(room, wall, position, width) {
  const half = width / 2;
  if (wall === "top" || wall === "bottom") {
    const y = wall === "top" ? room.gy : room.gy + room.gh;
    return { x1: room.gx + position - half, y1: y, x2: room.gx + position + half, y2: y };
  }
  const x = wall === "left" ? room.gx : room.gx + room.gw;
  return { x1: x, y1: room.gy + position - half, x2: x, y2: room.gy + position + half };
}

const FURNITURE_HIT_TOLERANCE = 0.12; // بالمتر — تسامح صغير للنقر قريب من حواف قطعة الأثاث

// بعد فعّال (عرض/عمق) لقطعة أثاث حسب دورانها — 90/270 بتبادل العرض والعمق (بلا حاجة لمثلثات
// بما إنه الدوران دايماً مضاعف 90°)
function furnitureFootprint(kind, rotation) {
  const k = FURNITURE_KINDS[kind];
  if (!k) return { w: 0.5, d: 0.5 };
  const swapped = rotation === 90 || rotation === 270;
  return { w: swapped ? k.d : k.w, d: swapped ? k.w : k.d };
}

// بيلاقي أقرب قطعة أثاث موجودة لنقطة نقر معيّنة، لتحديدها (نقل/تدوير/حذف)
function hitTestFurniture(rooms, cx, cy) {
  let best = null;
  rooms.forEach((r) => {
    (r.furniture || []).forEach((f) => {
      const { w, d } = furnitureFootprint(f.kind, f.rotation || 0);
      const ax0 = r.gx + f.x - w / 2, ax1 = r.gx + f.x + w / 2;
      const az0 = r.gy + f.y - d / 2, az1 = r.gy + f.y + d / 2;
      const dx = Math.max(ax0 - cx, 0, cx - ax1);
      const dz = Math.max(az0 - cy, 0, cy - az1);
      const dist = Math.hypot(dx, dz);
      if (!best || dist < best.dist) best = { dist, roomId: r.id, id: f.id, kind: f.kind, x: f.x, y: f.y, rotation: f.rotation || 0 };
    });
  });
  if (!best || best.dist > FURNITURE_HIT_TOLERANCE) return null;
  return best;
}

// بيلاقي الغرفة يلي جوّاها نقطة معيّنة (احتواء صارم، مش أقرب غرفة) لوضع قطعة أثاث فيها،
// بيحصر موضعها جوّا حدود الغرفة، ويرفض لو بتتراكب مع قطعة موجودة أصلاً (باستثناء excludeId
// أثناء النقل) أو لو القطعة أكبر من الغرفة
function hitTestRoomForFurniture(rooms, cx, cy, kind, excludeId) {
  const room = rooms.find((r) => cx >= r.gx && cx <= r.gx + r.gw && cy >= r.gy && cy <= r.gy + r.gh);
  if (!room) return null;
  const { w, d } = furnitureFootprint(kind, 0);
  if (room.gw < w || room.gh < d) return null;
  const half_w = w / 2, half_d = d / 2;
  const x = clamp(cx - room.gx, half_w, room.gw - half_w);
  const y = clamp(cy - room.gy, half_d, room.gh - half_d);

  const ax0 = x - half_w, ax1 = x + half_w, ay0 = y - half_d, ay1 = y + half_d;
  const overlaps = (room.furniture || []).some((f) => {
    if (f.id === excludeId) return false;
    const fp = furnitureFootprint(f.kind, f.rotation || 0);
    const fx0 = f.x - fp.w / 2, fx1 = f.x + fp.w / 2, fy0 = f.y - fp.d / 2, fy1 = f.y + fp.d / 2;
    return ax0 < fx1 && ax1 > fx0 && ay0 < fy1 && ay1 > fy0;
  });
  if (overlaps) return null;

  return { roomId: room.id, x, y };
}

const STAIR_HIT_TOLERANCE = 0.15; // بالمتر — تسامح النقر على علامة سلم موجودة

// فرق ارتفاع القاعدة (Y) بين طابق وياللي فوقه مباشرة — نفس منطق computeFloorBaseYMap
// المستخدم بالبناء ثلاثي الأبعاد، مطلوب هون لحساب طول مسار السلم بالمخطط 2D
function floorToFloorHeight(rooms, floor, projectWallHeight) {
  const map = computeFloorBaseYMap(rooms, projectWallHeight, floor + 1);
  return map.get(floor + 1) - map.get(floor);
}

// بعد فعّال (عرض/طول) لمساحة سلم حسب دورانه — نفس منطق furnitureFootprint بالضبط
function stairEffectiveFootprint(floorToFloorH, rotation) {
  const { w, d } = stairFootprint(floorToFloorH);
  const swapped = rotation === 90 || rotation === 270;
  return { w: swapped ? d : w, d: swapped ? w : d };
}

// بيلاقي أقرب سلم موجود (بنفس الطابق) لنقطة نقر معيّنة، لتحديده (نقل/تدوير/حذف)
function hitTestStairs(stairsForFloor, rooms, projectWallHeight, cx, cy) {
  let best = null;
  stairsForFloor.forEach((s) => {
    const h = floorToFloorHeight(rooms, s.floor ?? 0, projectWallHeight);
    const rotation = s.rotation || 0;
    const { w, d } = stairEffectiveFootprint(h, rotation);
    const ax0 = s.x - w / 2, ax1 = s.x + w / 2, ay0 = s.y - d / 2, ay1 = s.y + d / 2;
    const dx = Math.max(ax0 - cx, 0, cx - ax1);
    const dz = Math.max(ay0 - cy, 0, cy - ay1);
    const dist = Math.hypot(dx, dz);
    if (!best || dist < best.dist) best = { dist, id: s.id, floor: s.floor ?? 0, x: s.x, y: s.y, rotation };
  });
  if (!best || best.dist > STAIR_HIT_TOLERANCE) return null;
  return best;
}

// بيحصر موضع سلم جوّا حدود الشبكة كاملة (بعكس الأثاث، بلا حصر بغرفة — سلالم كتير خارجية)
function hitTestGridForStair(gridW, gridH, cx, cy, floorToFloorH, rotation) {
  const { w, d } = stairEffectiveFootprint(floorToFloorH, rotation);
  if (gridW < w || gridH < d) return null;
  const half_w = w / 2, half_d = d / 2;
  const x = clamp(cx, half_w, gridW - half_w);
  const y = clamp(cy, half_d, gridH - half_d);
  return { x, y };
}

// نسخة فاتحة (أبيض/رمادي) من رسم المخطط، مناسبة للطباعة/PDF بدل الثيم الغامق للتطبيق
function drawFloorPlanImage(floorRoomsList, gridW, gridH) {
  const canvas = document.createElement("canvas");
  canvas.width = gridW * PPM;
  canvas.height = gridH * PPM;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x <= gridW; x++) {
    ctx.strokeStyle = x % 5 === 0 ? "#CBD5E1" : "#EEF2F7";
    ctx.lineWidth = x % 5 === 0 ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(x * PPM + 0.5, 0);
    ctx.lineTo(x * PPM + 0.5, gridH * PPM);
    ctx.stroke();
  }
  for (let y = 0; y <= gridH; y++) {
    ctx.strokeStyle = y % 5 === 0 ? "#CBD5E1" : "#EEF2F7";
    ctx.lineWidth = y % 5 === 0 ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y * PPM + 0.5);
    ctx.lineTo(gridW * PPM, y * PPM + 0.5);
    ctx.stroke();
  }

  floorRoomsList.forEach((r) => {
    const x = r.gx * PPM, y = r.gy * PPM, rw = r.gw * PPM, rh = r.gh * PPM;
    ctx.fillStyle = r.color + "25";
    ctx.fillRect(x, y, rw, rh);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, rw, rh);
    ctx.fillStyle = "#1E293B";
    ctx.font = "700 13px Tajawal, sans-serif";
    ctx.fillText(r.name, x + 8, y + 20);
    ctx.fillStyle = "#64748B";
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(`${r.gw.toFixed(1)} × ${r.gh.toFixed(1)} m`, x + 8, y + 36);

    (r.openings || []).forEach((o) => {
      const width = o.kind === "door" ? DOOR_W : WIN_W;
      const m = openingMarkPoints(r, o.wall, o.position, width);
      ctx.strokeStyle = o.kind === "door" ? "#8B5A2B" : "#0EA5E9";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(m.x1 * PPM, m.y1 * PPM);
      ctx.lineTo(m.x2 * PPM, m.y2 * PPM);
      ctx.stroke();
    });

    (r.furniture || []).forEach((f) => {
      const { w, d: fd } = furnitureFootprint(f.kind, f.rotation || 0);
      const fx = (r.gx + f.x - w / 2) * PPM, fy = (r.gy + f.y - fd / 2) * PPM;
      ctx.fillStyle = "#A9895C25";
      ctx.fillRect(fx, fy, w * PPM, fd * PPM);
      ctx.strokeStyle = "#A9895C";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fy, w * PPM, fd * PPM);
      ctx.fillStyle = "#1E293B";
      ctx.font = "10px Tajawal, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(FURNITURE_KINDS[f.kind]?.label || "", fx + (w * PPM) / 2, fy + (fd * PPM) / 2 + 3);
      ctx.textAlign = "start";
    });
  });

  return canvas.toDataURL("image/png");
}

// أيقونة كل مرحلة حسب رقمها الثابت (المحتوى نفسه بينشئه Trigger داخل قاعدة البيانات)
const PHASE_ICONS = {
  1: MapPin,
  2: PencilRuler,
  3: Building2,
  4: FileCheck2,
  5: HardHat,
  6: ClipboardCheck,
  7: KeyRound,
};

const PPM = 32;

function snap(v, step = 0.5) {
  return Math.round(v / step) * step;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function Viewport3D({ rooms, stairs, wallHeight, wallColor, autoRotate }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const flagsRef = useRef({ autoRotate });
  const textureCacheRef = useRef(new Map());
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => { flagsRef.current.autoRotate = autoRotate; }, [autoRotate]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1c);
    scene.fog = new THREE.Fog(0x0a0f1c, 22, 60);

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
      new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(300, 150, 0x2c4568, 0x16223a);
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
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
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

// ---------------- شاشة إنشاء مشروع جديد ----------------
function ProjectSetup({ onCreate, onSignOut, userEmail, projectsList, onOpenProject }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [landType, setLandType] = useState(LAND_TYPES[0]);
  const [city, setCity] = useState("");
  const [width, setWidth] = useState(20);
  const [depth, setDepth] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canCreate = name.trim().length > 0 && !loading;

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      await onCreate({ name: name.trim(), client: client.trim(), landType, city: city.trim(), width, depth });
    } catch (err) {
      setError(err.message || "صار خطأ أثناء إنشاء المشروع، حاول من جديد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="w-full h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between gap-2.5 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md overflow-hidden shrink-0">
              <img src="/logo.png" alt="مُخطِّط · استوديو 360" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-none">مُخطِّط · استوديو 360</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">تصميم معماري وديكور بتقنية ثلاثية الأبعاد</p>
            </div>
          </div>
          <button onClick={onSignOut} title="تسجيل الخروج" className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 shrink-0">
            <LogOut size={13} /> خروج
          </button>
        </div>

        {userEmail && <p className="text-[11px] text-slate-500 mb-3 -mt-3 font-mono truncate" dir="ltr">{userEmail}</p>}

        {projectsList && projectsList.length > 0 && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 mb-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Folders size={14} /> مشاريعك السابقة</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {projectsList.map((p) => (
                <button key={p.id} onClick={() => onOpenProject(p.id)}
                  className="w-full text-right px-3 py-2 rounded-md text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700 transition-colors">
                  <p className="font-semibold text-slate-100 truncate">{p.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{p.land_type} · {p.city || "—"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-cyan-400 text-sm font-bold">
            <FolderPlus size={16} /> ابدأ مشروعاً جديداً من الصفر
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">اسم المشروع *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: فيلا العائلة" className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">اسم العميل (اختياري)</label>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="مثال: أبو محمد" className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">نوع الأرض</label>
              <select value={landType} onChange={(e) => setLandType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500">
                {LAND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">المدينة</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="مثال: عمّان" className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">أبعاد الأرض (متر)</label>
            <div className="flex items-center gap-2">
              <input type="number" min="6" max="60" value={width} onChange={(e) => setWidth(clamp(parseFloat(e.target.value) || 6, 6, 60))} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500 font-mono" />
              <span className="text-slate-500 text-xs">×</span>
              <input type="number" min="6" max="60" value={depth} onChange={(e) => setDepth(clamp(parseFloat(e.target.value) || 6, 6, 60))} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500 font-mono" />
              <span className="text-slate-500 text-xs whitespace-nowrap">متر</span>
            </div>
            <p className="text-[11px] font-mono text-slate-500 mt-1">المساحة الإجمالية: {(width * depth).toFixed(0)} م²</p>
          </div>

          <button
            disabled={!canCreate}
            onClick={handleCreate}
            className="w-full flex items-center justify-center gap-2 bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-md py-2.5 mt-1 transition-colors"
          >
            {loading ? (
              <>جارِ الإنشاء... <Loader2 size={16} className="animate-spin" /></>
            ) : (
              <>إنشاء المشروع <ChevronLeft size={16} /></>
            )}
          </button>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-md px-2.5 py-2">
              <AlertTriangle size={13} className="shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- شاشة تتبع مراحل المشروع ----------------
const statusMeta = {
  not_started: { label: "لم تبدأ", color: "text-slate-500", bg: "bg-slate-800", Icon: Circle },
  in_progress: { label: "قيد التنفيذ", color: "text-amber-400", bg: "bg-amber-500/15", Icon: Clock3 },
  done: { label: "مكتملة", color: "text-emerald-400", bg: "bg-emerald-500/15", Icon: CheckCircle2 },
};

function PhaseCard({ phase, expanded, onToggleExpand, onCycleStatus, onFieldCommit, onToggleSubtask, onAddSubtask, onRemoveSubtask, designProgress, onOpenDesign }) {
  const [newTask, setNewTask] = useState("");
  const [local, setLocal] = useState({ owner: phase.owner || "", notes: phase.notes || "" });
  const meta = statusMeta[phase.status];
  const Icon = PHASE_ICONS[phase.phase_key];
  const StatusIcon = meta.Icon;
  const doneSub = phase.subtasks.filter((s) => s.done).length;

  useEffect(() => {
    setLocal({ owner: phase.owner || "", notes: phase.notes || "" });
  }, [phase.owner, phase.notes]);

  function addSubtask() {
    const text = newTask.trim();
    if (!text) return;
    onAddSubtask(phase.id, text, phase.subtasks.length);
    setNewTask("");
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 p-3.5 cursor-pointer" onClick={onToggleExpand}>
        <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={16} className="text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">{phase.title}</p>
            {phase.links_to_design && (
              <button onClick={(e) => { e.stopPropagation(); onOpenDesign(); }} className="text-[11px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                فتح أداة التصميم
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{phase.description}</p>
          <p className="text-[11px] font-mono text-slate-600 mt-1">
            {doneSub}/{phase.subtasks.length} مهام فرعية
            {phase.links_to_design && designProgress > 0 ? ` · ${designProgress} غرفة مرسومة` : ""}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCycleStatus(); }}
          className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 shrink-0 transition-colors ${meta.bg} ${meta.color}`}
        >
          <StatusIcon size={13} /> {meta.label}
        </button>
        <ChevronDown size={16} className={`text-slate-500 shrink-0 mt-1.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-3.5 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 mb-1.5">المهام الفرعية</p>
            <div className="space-y-1.5">
              {phase.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <button onClick={() => onToggleSubtask(s.id, !s.done)} className="shrink-0">
                    {s.done ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} className="text-slate-600" />}
                  </button>
                  <span className={`text-xs flex-1 ${s.done ? "text-slate-500 line-through" : "text-slate-200"}`}>{s.text}</span>
                  <button onClick={() => onRemoveSubtask(s.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity">
                    <X size={13} />
                  </button>
                </div>
              ))}
              {phase.subtasks.length === 0 && <p className="text-[11px] text-slate-600">لا توجد مهام فرعية.</p>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="أضف مهمة فرعية..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
              />
              <button onClick={addSubtask} className="flex items-center gap-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-2.5 py-1.5">
                <Plus size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><CalendarDays size={12} /> تاريخ البدء</label>
              <input type="date" value={phase.start_date || ""} onChange={(e) => onFieldCommit(phase.id, "start_date", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><CalendarDays size={12} /> الانتهاء المتوقع</label>
              <input type="date" value={phase.end_date || ""} onChange={(e) => onFieldCommit(phase.id, "end_date", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono" />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><UserRound size={12} /> المسؤول عن هذه المرحلة</label>
            <input
              value={local.owner}
              onChange={(e) => setLocal((l) => ({ ...l, owner: e.target.value }))}
              onBlur={(e) => onFieldCommit(phase.id, "owner", e.target.value)}
              placeholder="مثال: المهندس الإنشائي - سامر"
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">ملاحظات</label>
            <textarea
              value={local.notes}
              onChange={(e) => setLocal((l) => ({ ...l, notes: e.target.value }))}
              onBlur={(e) => onFieldCommit(phase.id, "notes", e.target.value)}
              rows={2}
              placeholder="أي تفاصيل إضافية عن هذه المرحلة..."
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseTracker({ phases, setPhases, designProgress, onOpenDesign }) {
  const [expandedId, setExpandedId] = useState(null);

  async function cycleStatus(phase) {
    const next = phase.status === "not_started" ? "in_progress" : phase.status === "in_progress" ? "done" : "not_started";
    setPhases((prev) => prev.map((p) => (p.id === phase.id ? { ...p, status: next } : p)));
    const { error } = await supabase.from("phases").update({ status: next }).eq("id", phase.id);
    if (error) console.error("phase status update failed", error);
  }

  async function fieldCommit(phaseId, field, value) {
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, [field]: value } : p)));
    const payload = { [field]: value === "" && (field === "start_date" || field === "end_date") ? null : value };
    const { error } = await supabase.from("phases").update(payload).eq("id", phaseId);
    if (error) console.error("phase field update failed", error);
  }

  async function toggleSubtask(subtaskId, done) {
    setPhases((prev) => prev.map((p) => ({
      ...p,
      subtasks: p.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
    })));
    const { error } = await supabase.from("subtasks").update({ done }).eq("id", subtaskId);
    if (error) console.error("subtask toggle failed", error);
  }

  async function addSubtask(phaseId, text, sortOrder) {
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ phase_id: phaseId, text, sort_order: sortOrder })
      .select()
      .single();
    if (error) { console.error("add subtask failed", error); return; }
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, subtasks: [...p.subtasks, data] } : p)));
  }

  async function removeSubtask(subtaskId) {
    setPhases((prev) => prev.map((p) => ({ ...p, subtasks: p.subtasks.filter((s) => s.id !== subtaskId) })));
    const { error } = await supabase.from("subtasks").delete().eq("id", subtaskId);
    if (error) console.error("remove subtask failed", error);
  }

  const totalSub = phases.reduce((s, p) => s + p.subtasks.length, 0);
  const doneSub = phases.reduce((s, p) => s + p.subtasks.filter((t) => t.done).length, 0);
  const pct = totalSub === 0 ? 0 : Math.round((doneSub / totalSub) * 100);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold">التقدم العام</p>
            <p className="text-sm font-mono text-cyan-400">{pct}%</p>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">{doneSub} من {totalSub} مهمة فرعية مكتملة عبر كل المراحل</p>
        </div>

        <div className="space-y-2.5">
          {phases.map((p) => (
            <PhaseCard
              key={p.id}
              phase={p}
              expanded={expandedId === p.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
              onCycleStatus={() => cycleStatus(p)}
              onFieldCommit={fieldCommit}
              onToggleSubtask={toggleSubtask}
              onAddSubtask={addSubtask}
              onRemoveSubtask={removeSubtask}
              designProgress={designProgress}
              onOpenDesign={onOpenDesign}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- التطبيق الرئيسي ----------------
export default function ArchitectStudio({ session }) {
  const user = session.user;
  const [project, setProject] = useState(null);
  const [projectsList, setProjectsList] = useState([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [phases, setPhases] = useState([]);
  const [view, setView] = useState("phases"); // 'phases' | 'plan' | '3d'
  const [confirmReset, setConfirmReset] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [initializing, setInitializing] = useState(true);

  const [rooms, setRooms] = useState([]);
  const [stairsList, setStairsList] = useState([]);
  const [wallHeight, setWallHeight] = useState(2.7);
  const [roomColor, setRoomColor] = useState(ROOM_COLORS[0].hex);
  const [wallColor, setWallColor] = useState(WALL_COLORS[0].hex);
  const [autoRotate, setAutoRotate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [placeMode, setPlaceMode] = useState(null); // null | 'door' | 'window' | 'furniture:<kind>'
  const [selectedOpening, setSelectedOpening] = useState(null); // {id, roomId, wall, position, kind} | null
  const [movingOpeningId, setMovingOpeningId] = useState(null);
  const [selectedFurniture, setSelectedFurniture] = useState(null); // {id, roomId, kind, x, y, rotation} | null
  const [movingFurnitureId, setMovingFurnitureId] = useState(null);
  const [selectedStair, setSelectedStair] = useState(null); // {id, floor, x, y, rotation} | null
  const [movingStairId, setMovingStairId] = useState(null);
  const [currentFloor, setCurrentFloor] = useState(0);
  const [printData, setPrintData] = useState(null);
  const [confirmDeleteFloor, setConfirmDeleteFloor] = useState(false);

  useEffect(() => {
    setSelectedOpening(null);
    setSelectedFurniture(null);
    setSelectedStair(null);
  }, [currentFloor]);

  useEffect(() => {
    if (!placeMode) {
      setMovingOpeningId(null);
      setMovingFurnitureId(null);
      setMovingStairId(null);
    }
  }, [placeMode]);

  const sharedBoundaries = useMemo(() => computeSharedBoundaries(rooms), [rooms]);
  const sharedRanges = useMemo(() => sharedWallRanges(sharedBoundaries), [sharedBoundaries]);

  const canvasRef = useRef(null);
  const draftRef = useRef(null);
  const draggingRef = useRef(false);
  const hoverRef = useRef(null); // {roomId, wall, position} أثناء وضع الإضافة

  const gridW = project ? clamp(project.width, 6, 60) : 20;
  const gridH = project ? clamp(project.depth, 6, 60) : 15;

  const drawPlan = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0A0F1C";
    ctx.fillRect(0, 0, w, h);

    for (let x = 0; x <= gridW; x++) {
      ctx.strokeStyle = x % 5 === 0 ? "#2C4568" : "#16223A";
      ctx.lineWidth = x % 5 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x * PPM + 0.5, 0);
      ctx.lineTo(x * PPM + 0.5, gridH * PPM);
      ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
      ctx.strokeStyle = y % 5 === 0 ? "#2C4568" : "#16223A";
      ctx.lineWidth = y % 5 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y * PPM + 0.5);
      ctx.lineTo(gridW * PPM, y * PPM + 0.5);
      ctx.stroke();
    }

    const floorRoomsList = rooms.filter((r) => (r.floor ?? 0) === currentFloor);

    floorRoomsList.forEach((r) => {
      const x = r.gx * PPM, y = r.gy * PPM, rw = r.gw * PPM, rh = r.gh * PPM;
      ctx.fillStyle = r.color + "30";
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = r.id === selectedId ? "#22D3EE" : r.color;
      ctx.lineWidth = r.id === selectedId ? 3 : 2;
      ctx.strokeRect(x, y, rw, rh);
      ctx.fillStyle = "#EAF0F8";
      ctx.font = "700 13px Tajawal, sans-serif";
      ctx.fillText(r.name, x + 8, y + 20);
      ctx.fillStyle = "#8DA0BC";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${r.gw.toFixed(1)} × ${r.gh.toFixed(1)} m`, x + 8, y + 36);

      (r.openings || []).forEach((o) => {
        const width = o.kind === "door" ? DOOR_W : WIN_W;
        const m = openingMarkPoints(r, o.wall, o.position, width);
        ctx.strokeStyle = o.kind === "door" ? "#8B5A2B" : "#9FD8E8";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(m.x1 * PPM, m.y1 * PPM);
        ctx.lineTo(m.x2 * PPM, m.y2 * PPM);
        ctx.stroke();
      });

      (r.furniture || []).forEach((f) => {
        const { w, d: fd } = furnitureFootprint(f.kind, f.rotation || 0);
        const fx = (r.gx + f.x - w / 2) * PPM, fy = (r.gy + f.y - fd / 2) * PPM;
        const isSel = selectedFurniture?.id === f.id;
        ctx.fillStyle = isSel ? "#22D3EE55" : "#A9895C55";
        ctx.fillRect(fx, fy, w * PPM, fd * PPM);
        ctx.strokeStyle = isSel ? "#22D3EE" : "#A9895C";
        ctx.lineWidth = isSel ? 2 : 1.5;
        ctx.strokeRect(fx, fy, w * PPM, fd * PPM);
        ctx.fillStyle = "#EAF0F8";
        ctx.font = "10px Tajawal, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(FURNITURE_KINDS[f.kind]?.label || "", fx + (w * PPM) / 2, fy + (fd * PPM) / 2 + 3);
        ctx.textAlign = "start";
      });
    });

    stairsList.filter((s) => (s.floor ?? 0) === currentFloor).forEach((s) => {
      const h = floorToFloorHeight(rooms, currentFloor, wallHeight);
      const { w, d: sd } = stairEffectiveFootprint(h, s.rotation || 0);
      const sx = (s.x - w / 2) * PPM, sy = (s.y - sd / 2) * PPM;
      const isSel = selectedStair?.id === s.id;
      ctx.fillStyle = isSel ? "#22D3EE55" : "#8DA0BC44";
      ctx.fillRect(sx, sy, w * PPM, sd * PPM);
      ctx.strokeStyle = isSel ? "#22D3EE" : "#8DA0BC";
      ctx.lineWidth = isSel ? 2 : 1.5;
      ctx.strokeRect(sx, sy, w * PPM, sd * PPM);
      ctx.fillStyle = "#EAF0F8";
      ctx.font = "10px Tajawal, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("سلم", sx + (w * PPM) / 2, sy + (sd * PPM) / 2 + 3);
      ctx.textAlign = "start";
    });

    const d = draftRef.current;
    if (d) {
      const gx = Math.min(d.sx, d.ex), gy = Math.min(d.sy, d.ey);
      const gw = Math.abs(d.ex - d.sx), gh = Math.abs(d.ey - d.sy);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#22D3EE";
      ctx.lineWidth = 2;
      ctx.strokeRect(gx * PPM, gy * PPM, gw * PPM, gh * PPM);
      ctx.setLineDash([]);
    }

    if (placeMode && hoverRef.current) {
      const room = floorRoomsList.find((r) => r.id === hoverRef.current.roomId);
      if (room) {
        const width = placeMode === "door" ? DOOR_W : WIN_W;
        const m = openingMarkPoints(room, hoverRef.current.wall, hoverRef.current.position, width);
        ctx.strokeStyle = placeMode === "door" ? "#C88A5A" : "#C7EFFA";
        ctx.lineWidth = 7;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(m.x1 * PPM, m.y1 * PPM);
        ctx.lineTo(m.x2 * PPM, m.y2 * PPM);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, [rooms, selectedId, selectedFurniture, stairsList, selectedStair, wallHeight, gridW, gridH, placeMode, currentFloor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = gridW * PPM;
    canvas.height = gridH * PPM;
    drawPlan();
  }, [drawPlan, gridW, gridH, view]);

  function getMeterCoords(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    return { x: snap(clamp(px / PPM, 0, gridW)), y: snap(clamp(py / PPM, 0, gridH)) };
  }

  // إحداثيات بدون snapping — لازمة لاكتشاف أقرب جدار بدقة (لا نريد قفزات كل 0.5م)
  function getMeterCoordsRaw(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    return { x: clamp(px / PPM, 0, gridW), y: clamp(py / PPM, 0, gridH) };
  }

  function handlePointerDown(e) {
    if (placeMode?.startsWith("furniture:")) {
      const kind = placeMode.slice("furniture:".length);
      const { x, y } = getMeterCoordsRaw(e);
      const hit = hitTestRoomForFurniture(rooms.filter((r) => (r.floor ?? 0) === currentFloor), x, y, kind, movingFurnitureId);
      if (hit) placeFurniture(hit.roomId, kind, hit.x, hit.y);
      return;
    }
    if (placeMode === "stairs") {
      const { x, y } = getMeterCoordsRaw(e);
      const h = floorToFloorHeight(rooms, currentFloor, wallHeight);
      const movingStair = movingStairId ? stairsList.find((s) => s.id === movingStairId) : null;
      const hit = hitTestGridForStair(gridW, gridH, x, y, h, movingStair?.rotation || 0);
      if (hit) placeStair(currentFloor, hit.x, hit.y);
      return;
    }
    if (placeMode) {
      const { x, y } = getMeterCoordsRaw(e);
      const width = placeMode === "door" ? DOOR_W : WIN_W;
      const hit = hitTestWalls(rooms.filter((r) => (r.floor ?? 0) === currentFloor), x, y, width, placeMode, sharedRanges, movingOpeningId);
      if (hit) placeOpening(hit.roomId, hit.wall, placeMode, hit.position);
      return;
    }
    const raw = getMeterCoordsRaw(e);
    const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
    const openingHit = hitTestOpenings(floorRoomsNow, raw.x, raw.y);
    if (openingHit) {
      setSelectedOpening(openingHit);
      setSelectedFurniture(null);
      setSelectedStair(null);
      setSelectedId(null);
      return;
    }
    const furnitureHit = hitTestFurniture(floorRoomsNow, raw.x, raw.y);
    if (furnitureHit) {
      setSelectedFurniture(furnitureHit);
      setSelectedOpening(null);
      setSelectedStair(null);
      setSelectedId(null);
      return;
    }
    const stairsForFloor = stairsList.filter((s) => (s.floor ?? 0) === currentFloor);
    const stairHit = hitTestStairs(stairsForFloor, rooms, wallHeight, raw.x, raw.y);
    if (stairHit) {
      setSelectedStair(stairHit);
      setSelectedOpening(null);
      setSelectedFurniture(null);
      setSelectedId(null);
      return;
    }
    setSelectedOpening(null);
    setSelectedFurniture(null);
    setSelectedStair(null);
    const { x, y } = getMeterCoords(e);
    draggingRef.current = true;
    draftRef.current = { sx: x, sy: y, ex: x, ey: y };
    setSelectedId(null);
  }
  function handlePointerMove(e) {
    if (placeMode?.startsWith("furniture:")) {
      const kind = placeMode.slice("furniture:".length);
      const { x, y } = getMeterCoordsRaw(e);
      hoverRef.current = hitTestRoomForFurniture(rooms.filter((r) => (r.floor ?? 0) === currentFloor), x, y, kind, movingFurnitureId);
      drawPlan();
      return;
    }
    if (placeMode === "stairs") {
      const { x, y } = getMeterCoordsRaw(e);
      const h = floorToFloorHeight(rooms, currentFloor, wallHeight);
      const movingStair = movingStairId ? stairsList.find((s) => s.id === movingStairId) : null;
      hoverRef.current = hitTestGridForStair(gridW, gridH, x, y, h, movingStair?.rotation || 0);
      drawPlan();
      return;
    }
    if (placeMode) {
      const { x, y } = getMeterCoordsRaw(e);
      const width = placeMode === "door" ? DOOR_W : WIN_W;
      hoverRef.current = hitTestWalls(rooms.filter((r) => (r.floor ?? 0) === currentFloor), x, y, width, placeMode, sharedRanges, movingOpeningId);
      drawPlan();
      return;
    }
    if (!draggingRef.current) return;
    const { x, y } = getMeterCoords(e);
    draftRef.current = { ...draftRef.current, ex: x, ey: y };
    drawPlan();
  }
  async function handlePointerUp() {
    if (placeMode) {
      hoverRef.current = null;
      drawPlan();
      return;
    }
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    if (!d || !project) return;
    const gx = Math.min(d.sx, d.ex), gy = Math.min(d.sy, d.ey);
    const gw = Math.abs(d.ex - d.sx), gh = Math.abs(d.ey - d.sy);
    if (gw >= 1 && gh >= 1) {
      const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          project_id: project.id, name: ROOM_TYPES[0], gx, gy, gw, gh, color: roomColor, floor: currentFloor, has_roof: false,
          wall_height: floorRoomsNow[0]?.wall_height ?? null,
          wall_color: floorRoomsNow[0]?.wall_color ?? null,
        })
        .select("*, openings(*), furniture(*)")
        .single();
      if (error) { console.error("insert room failed", error); drawPlan(); return; }
      setRooms((prev) => [...prev, data]);
    } else {
      drawPlan();
    }
  }

  async function placeOpening(roomId, wall, kind, position) {
    if (movingOpeningId) {
      const openingId = movingOpeningId;
      const { data, error } = await supabase
        .from("openings")
        .update({ room_id: roomId, wall, position })
        .eq("id", openingId)
        .select()
        .single();
      if (error) { console.error("move opening failed", error); return; }
      setRooms((prev) => prev.map((r) => {
        const withoutOld = (r.openings || []).filter((o) => o.id !== openingId);
        return { ...r, openings: r.id === roomId ? [...withoutOld, data] : withoutOld };
      }));
      setMovingOpeningId(null);
      setPlaceMode(null);
      hoverRef.current = null;
      drawPlan();
      return;
    }

    const { data, error } = await supabase
      .from("openings")
      .insert({ room_id: roomId, wall, kind, position })
      .select()
      .single();
    if (error) { console.error("insert opening failed", error); return; }
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, openings: [...(r.openings || []), data] } : r)));
    // نضل بوضع الإضافة (بلا setPlaceMode(null)) — تسمح بإضافة أكتر من باب/نافذة ورا بعض
    // بلا ما يحتاج المستخدم يدوس الزر من جديد كل مرة؛ يطلع من الوضع يدوياً بدوسة تانية عالزر
    drawPlan();
  }

  async function deleteOpening(opening) {
    setRooms((prev) => prev.map((r) => (r.id === opening.roomId ? { ...r, openings: (r.openings || []).filter((o) => o.id !== opening.id) } : r)));
    setSelectedOpening(null);
    const { error } = await supabase.from("openings").delete().eq("id", opening.id);
    if (error) console.error("delete opening failed", error);
  }

  function startMoveOpening(opening) {
    setSelectedOpening(null);
    setMovingOpeningId(opening.id);
    setPlaceMode(opening.kind);
  }

  async function placeFurniture(roomId, kind, x, y) {
    if (movingFurnitureId) {
      const furnitureId = movingFurnitureId;
      const { data, error } = await supabase
        .from("furniture")
        .update({ room_id: roomId, x, y })
        .eq("id", furnitureId)
        .select()
        .single();
      if (error) { console.error("move furniture failed", error); return; }
      setRooms((prev) => prev.map((r) => {
        const withoutOld = (r.furniture || []).filter((f) => f.id !== furnitureId);
        return { ...r, furniture: r.id === roomId ? [...withoutOld, data] : withoutOld };
      }));
      setMovingFurnitureId(null);
      setPlaceMode(null);
      hoverRef.current = null;
      drawPlan();
      return;
    }

    const { data, error } = await supabase
      .from("furniture")
      .insert({ room_id: roomId, kind, x, y })
      .select()
      .single();
    if (error) { console.error("insert furniture failed", error); return; }
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, furniture: [...(r.furniture || []), data] } : r)));
    // نضل بوضع الإضافة (بلا setPlaceMode(null)) — نفس منطق الأبواب/النوافذ، تسمح بإضافة
    // أكتر من قطعة ورا بعض بلا داعي لإعادة الضغط على الزر كل مرة
    drawPlan();
  }

  async function deleteFurniture(item) {
    setRooms((prev) => prev.map((r) => (r.id === item.roomId ? { ...r, furniture: (r.furniture || []).filter((f) => f.id !== item.id) } : r)));
    setSelectedFurniture(null);
    const { error } = await supabase.from("furniture").delete().eq("id", item.id);
    if (error) console.error("delete furniture failed", error);
  }

  function startMoveFurniture(item) {
    setSelectedFurniture(null);
    setMovingFurnitureId(item.id);
    setPlaceMode(`furniture:${item.kind}`);
  }

  async function rotateFurniture(item) {
    const nextRotation = (item.rotation + 90) % 360;
    setRooms((prev) => prev.map((r) => (r.id === item.roomId ? { ...r, furniture: (r.furniture || []).map((f) => (f.id === item.id ? { ...f, rotation: nextRotation } : f)) } : r)));
    setSelectedFurniture((s) => (s && s.id === item.id ? { ...s, rotation: nextRotation } : s));
    const { error } = await supabase.from("furniture").update({ rotation: nextRotation }).eq("id", item.id);
    if (error) console.error("rotate furniture failed", error);
  }

  async function placeStair(floor, x, y) {
    if (!project) return;
    if (movingStairId) {
      const stairId = movingStairId;
      const { data, error } = await supabase
        .from("stairs")
        .update({ floor, x, y })
        .eq("id", stairId)
        .select()
        .single();
      if (error) { console.error("move stair failed", error); return; }
      setStairsList((prev) => prev.map((s) => (s.id === stairId ? data : s)));
      setMovingStairId(null);
      setPlaceMode(null);
      hoverRef.current = null;
      drawPlan();
      return;
    }

    const { data, error } = await supabase
      .from("stairs")
      .insert({ project_id: project.id, floor, x, y })
      .select()
      .single();
    if (error) { console.error("insert stair failed", error); return; }
    setStairsList((prev) => [...prev, data]);
    // نضل بوضع الإضافة (نفس منطق الأبواب/النوافذ/الأثاث)
    drawPlan();
  }

  async function deleteStair(stair) {
    setStairsList((prev) => prev.filter((s) => s.id !== stair.id));
    setSelectedStair(null);
    const { error } = await supabase.from("stairs").delete().eq("id", stair.id);
    if (error) console.error("delete stair failed", error);
  }

  function startMoveStair(stair) {
    setSelectedStair(null);
    setMovingStairId(stair.id);
    setPlaceMode("stairs");
  }

  async function rotateStair(stair) {
    const nextRotation = (stair.rotation + 90) % 360;
    setStairsList((prev) => prev.map((s) => (s.id === stair.id ? { ...s, rotation: nextRotation } : s)));
    setSelectedStair((s) => (s && s.id === stair.id ? { ...s, rotation: nextRotation } : s));
    const { error } = await supabase.from("stairs").update({ rotation: nextRotation }).eq("id", stair.id);
    if (error) console.error("rotate stair failed", error);
  }

  async function renameRoom(id, name) {
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    const { error } = await supabase.from("rooms").update({ name }).eq("id", id);
    if (error) console.error("rename room failed", error);
  }

  async function deleteRoom(id) {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    const { error } = await supabase.from("rooms").delete().eq("id", id);
    if (error) console.error("delete room failed", error);
  }

  async function toggleRoomRoof(id) {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    const hasRoof = !room.has_roof;
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, has_roof: hasRoof } : r)));
    const { error } = await supabase.from("rooms").update({ has_roof: hasRoof }).eq("id", id);
    if (error) console.error("toggle roof failed", error);
  }

  async function clearRooms() {
    if (!project) return;
    setRooms((prev) => prev.filter((r) => (r.floor ?? 0) !== currentFloor));
    setSelectedId(null);
    const { error } = await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", currentFloor);
    if (error) console.error("clear rooms failed", error);
  }

  async function deleteFloor() {
    if (!project || currentFloor === 0) return;
    const floorToDelete = currentFloor;
    setRooms((prev) => prev.filter((r) => (r.floor ?? 0) !== floorToDelete));
    setConfirmDeleteFloor(false);
    setCurrentFloor(0);
    const { error } = await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", floorToDelete);
    if (error) console.error("delete floor failed", error);
  }

  const FLOOR_SWAP_SENTINEL = -999; // قيمة مستحيلة كرقم طابق حقيقي (الطوابق 0..FLOOR_CAP بس)

  async function swapFloors(fromFloor, toFloor) {
    if (!project || toFloor < 0 || toFloor > FLOOR_CAP || toFloor === fromFloor) return;

    let res = await supabase.from("rooms").update({ floor: FLOOR_SWAP_SENTINEL }).eq("project_id", project.id).eq("floor", fromFloor);
    if (res.error) { console.error("swap floor step1 failed", res.error); return; }

    res = await supabase.from("rooms").update({ floor: fromFloor }).eq("project_id", project.id).eq("floor", toFloor);
    if (res.error) {
      console.error("swap floor step2 failed", res.error);
      await supabase.from("rooms").update({ floor: fromFloor }).eq("project_id", project.id).eq("floor", FLOOR_SWAP_SENTINEL);
      return;
    }

    res = await supabase.from("rooms").update({ floor: toFloor }).eq("project_id", project.id).eq("floor", FLOOR_SWAP_SENTINEL);
    if (res.error) { console.error("swap floor step3 failed — rows stranded at sentinel floor", res.error); return; }

    setRooms((prev) => prev.map((r) => {
      const f = r.floor ?? 0;
      if (f === fromFloor) return { ...r, floor: toFloor };
      if (f === toFloor) return { ...r, floor: fromFloor };
      return r;
    }));
    setCurrentFloor(toFloor);
  }

  async function loadSample() {
    if (!project) return;
    const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
    const inheritedHeight = floorRoomsNow[0]?.wall_height ?? null;
    const inheritedColor = floorRoomsNow[0]?.wall_color ?? null;
    const sample = [
      { project_id: project.id, name: "صالة", gx: 1, gy: 1, gw: 6, gh: 5, color: ROOM_COLORS[0].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "مطبخ", gx: 7.5, gy: 1, gw: 4, gh: 5, color: ROOM_COLORS[1].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "غرفة نوم", gx: 1, gy: 6.5, gw: 5, gh: 4, color: ROOM_COLORS[2].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "حمام", gx: 6.5, gy: 6.5, gw: 3, gh: 4, color: ROOM_COLORS[3].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
    ];
    await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", currentFloor);
    const { data, error } = await supabase.from("rooms").insert(sample).select("*, openings(*), furniture(*)");
    if (error) { console.error("load sample failed", error); return; }
    setRooms((prev) => [...prev.filter((r) => (r.floor ?? 0) !== currentFloor), ...data]);
    setSelectedId(null);
  }

  async function fetchPhasesForProject(projectId) {
    const { data, error } = await supabase
      .from("phases")
      .select("*, subtasks(*)")
      .eq("project_id", projectId)
      .order("phase_key", { ascending: true });
    if (error) throw error;
    return data.map((p) => ({
      ...p,
      subtasks: (p.subtasks || []).slice().sort((a, b) => a.sort_order - b.sort_order),
    }));
  }

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message || "تعذر تحميل مشاريعك");
        setInitializing(false);
        return;
      }
      setProjectsList(projects || []);
      const proj = projects && projects[0];
      if (proj) {
        const [phasesData, roomsRes, stairsRes] = await Promise.all([
          fetchPhasesForProject(proj.id),
          supabase.from("rooms").select("*, openings(*), furniture(*)").eq("project_id", proj.id),
          supabase.from("stairs").select("*").eq("project_id", proj.id),
        ]);
        if (cancelled) return;
        setProject(proj);
        setPhases(phasesData);
        setRooms(roomsRes.data || []);
        setStairsList(stairsRes.data || []);
        setWallHeight(proj.wall_height);
        setWallColor(proj.wall_color);
      }
      setInitializing(false);
    }
    loadInitial();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "plan") {
      setPlaceMode(null);
      hoverRef.current = null;
    }
  }, [view]);

  useEffect(() => {
    setPlaceMode(null);
    hoverRef.current = null;
    setSelectedId(null);
    setConfirmDeleteFloor(false);
  }, [currentFloor]);

  useEffect(() => {
    if (printData) window.print();
  }, [printData]);

  function handlePrint() {
    if (!project) return;
    const floorNums = [...new Set(rooms.map((r) => r.floor ?? 0))].sort((a, b) => a - b);
    const floors = (floorNums.length ? floorNums : [0]).map((f) => {
      const floorRoomsList = rooms.filter((r) => (r.floor ?? 0) === f);
      return {
        floorNum: f,
        label: floorLabel(f),
        imageDataUrl: drawFloorPlanImage(floorRoomsList, gridW, gridH),
        rooms: floorRoomsList,
      };
    });
    setPrintData({ floors });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function handleCreateProject(formData) {
    const { data: proj, error } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: formData.name,
        client: formData.client,
        land_type: formData.landType,
        city: formData.city,
        width: formData.width,
        depth: formData.depth,
      })
      .select()
      .single();
    if (error) throw error;

    const phasesData = await fetchPhasesForProject(proj.id);

    setProjectsList((prev) => [proj, ...prev]);
    setProject(proj);
    setPhases(phasesData);
    setRooms([]);
    setStairsList([]);
    setWallHeight(proj.wall_height);
    setWallColor(proj.wall_color);
    setSelectedId(null);
    setCurrentFloor(0);
    setView("phases");
    setLoadError("");
  }

  async function loadProjectById(projId) {
    const proj = projectsList.find((p) => p.id === projId);
    if (!proj || proj.id === project?.id) { setSwitcherOpen(false); return; }
    setInitializing(true);
    setSwitcherOpen(false);
    const [phasesData, roomsRes, stairsRes] = await Promise.all([
      fetchPhasesForProject(proj.id),
      supabase.from("rooms").select("*, openings(*), furniture(*)").eq("project_id", proj.id),
      supabase.from("stairs").select("*").eq("project_id", proj.id),
    ]);
    setProject(proj);
    setPhases(phasesData);
    setRooms(roomsRes.data || []);
    setStairsList(stairsRes.data || []);
    setWallHeight(proj.wall_height);
    setWallColor(proj.wall_color);
    setSelectedId(null);
    setCurrentFloor(0);
    setConfirmReset(false);
    setView("phases");
    setInitializing(false);
  }

  function currentFloorWallHeight() {
    const room = rooms.find((r) => (r.floor ?? 0) === currentFloor);
    return room?.wall_height ?? wallHeight;
  }
  function currentFloorWallColor() {
    const room = rooms.find((r) => (r.floor ?? 0) === currentFloor);
    return room?.wall_color ?? wallColor;
  }

  // معاينة حية أثناء سحب شريط الارتفاع — تحديث محلي بس، بلا كتابة لقاعدة البيانات
  function previewFloorWallHeight(value) {
    setRooms((prev) => prev.map((r) => ((r.floor ?? 0) === currentFloor ? { ...r, wall_height: value } : r)));
  }

  async function commitFloorWallHeight(value) {
    if (!project || floorRooms.length === 0) return;
    const { error } = await supabase.from("rooms").update({ wall_height: value }).eq("project_id", project.id).eq("floor", currentFloor);
    if (error) console.error("update floor wall height failed", error);
  }

  async function setFloorWallColor(hex) {
    if (!project || floorRooms.length === 0) return;
    setRooms((prev) => prev.map((r) => ((r.floor ?? 0) === currentFloor ? { ...r, wall_color: hex } : r)));
    const { error } = await supabase.from("rooms").update({ wall_color: hex }).eq("project_id", project.id).eq("floor", currentFloor);
    if (error) console.error("update floor wall color failed", error);
  }

  function startOver() {
    setProject(null);
    setPhases([]);
    setRooms([]);
    setSelectedId(null);
    setConfirmReset(false);
    setView("phases");
  }

  if (initializing) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-950">
        <Loader2 size={24} className="text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (loadError && !project) {
    return (
      <div dir="rtl" className="w-full h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4" style={{ fontFamily: "'Tajawal', sans-serif" }}>
        <div className="text-center space-y-3">
          <p className="flex items-center justify-center gap-1.5 text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0" /> تعذر تحميل بياناتك: {loadError}
          </p>
          <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2">تسجيل الخروج</button>
        </div>
      </div>
    );
  }

  if (!project) {
    return <ProjectSetup onCreate={handleCreateProject} onSignOut={signOut} userEmail={user.email} projectsList={projectsList} onOpenProject={loadProjectById} />;
  }

  const floors = [...new Set([0, currentFloor, ...rooms.map((r) => r.floor ?? 0)])].sort((a, b) => a - b);
  const floorRooms = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
  const totalArea = floorRooms.reduce((s, r) => s + r.gw * r.gh, 0);

  return (
    <>
    <div id="app-shell" dir="rtl" className="w-full h-screen flex flex-col bg-slate-950 text-slate-100" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <style>{`input[type="range"] { accent-color: #22D3EE; }`}</style>

      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-5 py-3 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-md overflow-hidden shrink-0">
            <img src="/logo.png" alt="مُخطِّط · استوديو 360" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold leading-none truncate">{project.name}</h1>
            <p className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
              {project.land_type} · {project.city || "—"} · {project.width}×{project.depth} م
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/70 rounded-lg p-1">
          <button onClick={() => setView("phases")} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${view === "phases" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}>
            مراحل المشروع
          </button>
          <button onClick={() => setView("plan")} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${view === "plan" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}>
            مخطط 2D
          </button>
          <button
            disabled={rooms.length === 0}
            title={rooms.length === 0 ? "ارسم غرفة واحدة على الأقل أولاً" : ""}
            onClick={() => setView("3d")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${view === "3d" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
          >
            عرض 3D · 360°
          </button>
        </div>

        <div className="flex items-center gap-1">
          {projectsList.length > 1 && (
            <div className="relative">
              <button onClick={() => setSwitcherOpen((o) => !o)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5">
                <Folders size={13} /> مشاريعي
              </button>
              {switcherOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 w-64 max-h-80 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-20 p-1.5">
                    {projectsList.map((p) => (
                      <button key={p.id} onClick={() => loadProjectById(p.id)}
                        className={`w-full text-right px-2.5 py-2 rounded-md text-xs transition-colors ${p.id === project.id ? "bg-cyan-500/20 text-cyan-300" : "hover:bg-slate-800 text-slate-200"}`}>
                        <p className="font-semibold truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{p.land_type} · {p.city || "—"}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {confirmReset ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">متأكد؟</span>
              <button onClick={startOver} className="px-2.5 py-1 rounded-md bg-red-600/80 hover:bg-red-600 font-semibold">نعم، ابدأ من جديد</button>
              <button onClick={() => setConfirmReset(false)} className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700">تراجع</button>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5">
              <FolderPlus size={13} /> مشروع جديد
            </button>
          )}
          <button onClick={handlePrint} title="طباعة المخطط / حفظ PDF" className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5">
            <Printer size={13} /> طباعة / PDF
          </button>
          <button onClick={signOut} title="تسجيل الخروج" className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5">
            <LogOut size={13} /> خروج
          </button>
        </div>
      </header>

      {view === "phases" && (
        <PhaseTracker
          phases={phases}
          setPhases={setPhases}
          designProgress={rooms.length}
          onOpenDesign={() => setView("plan")}
        />
      )}

      {(view === "plan" || view === "3d") && (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-72 shrink-0 border-l border-slate-800 bg-slate-900/40 overflow-y-auto p-4 space-y-6">
            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2">الطوابق</p>
                <div className="flex flex-wrap items-center gap-1 bg-slate-800/70 rounded-lg p-1">
                  {floors.map((f) => (
                    <button key={f} onClick={() => setCurrentFloor(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${f === currentFloor ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}>
                      {floorLabel(f)}
                    </button>
                  ))}
                  {Math.max(0, ...floors) < FLOOR_CAP && (
                    <button onClick={() => setCurrentFloor(Math.max(0, ...floors) + 1)} title="إضافة طابق"
                      className="px-2.5 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-700">
                      <Plus size={13} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-2">
                  <button disabled={currentFloor === 0} onClick={() => swapFloors(currentFloor, currentFloor - 1)}
                    title={`مبادلة مع ${floorLabel(currentFloor - 1)}`}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-1">
                    <ChevronDown size={12} />
                  </button>
                  <button disabled={currentFloor + 1 > FLOOR_CAP} onClick={() => swapFloors(currentFloor, currentFloor + 1)}
                    title={`مبادلة مع ${floorLabel(currentFloor + 1)}`}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-1">
                    <ChevronUp size={12} />
                  </button>

                  {currentFloor !== 0 && (
                    confirmDeleteFloor ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-400">متأكد؟</span>
                        <button onClick={deleteFloor} className="px-2.5 py-1 rounded-md bg-red-600/80 hover:bg-red-600 font-semibold">نعم، احذف</button>
                        <button onClick={() => setConfirmDeleteFloor(false)} className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700">تراجع</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteFloor(true)} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-red-400 px-2 py-1">
                        <Trash2 size={12} /> حذف {floorLabel(currentFloor)}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Layers size={13}/> الأدوات</p>
              <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">اسحب على الشبكة في المخطط لإنشاء غرفة جديدة.</p>
              <div className="flex gap-2">
                <button onClick={loadSample} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-2 transition-colors">
                  <Sparkles size={13}/> نموذج جاهز
                </button>
                <button onClick={clearRooms} className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-red-950 hover:text-red-300 border border-slate-700 rounded-md px-3 transition-colors">
                  <Trash2 size={13}/>
                </button>
              </div>
            </div>

            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><DoorOpen size={13}/> الأبواب والنوافذ</p>
                <div className="flex gap-2">
                  <button
                    disabled={floorRooms.length === 0}
                    onClick={() => { setSelectedOpening(null); setMovingOpeningId(null); setPlaceMode((m) => (m === "window" ? null : "window")); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${placeMode === "window" ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}
                  >
                    <AppWindow size={13}/> نافذة+
                  </button>
                  <button
                    disabled={floorRooms.length === 0}
                    onClick={() => { setSelectedOpening(null); setMovingOpeningId(null); setPlaceMode((m) => (m === "door" ? null : "door")); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${placeMode === "door" ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}
                  >
                    <DoorOpen size={13}/> باب+
                  </button>
                </div>
                {placeMode && (
                  <p className="text-[11px] text-cyan-300 mt-2 leading-relaxed">
                    {movingOpeningId
                      ? `دوس على جدار جديد لنقل ${placeMode === "door" ? "الباب" : "النافذة"}.`
                      : `دوس على أي جدار بالمخطط لتحديد مكان ${placeMode === "door" ? "الباب" : "النافذة"}.`}
                  </p>
                )}
                {selectedOpening && (
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    محدد: {selectedOpening.kind === "door" ? "باب" : "نافذة"} — دوس "نقل" أو "حذف" بالمخطط.
                  </p>
                )}
              </div>
            )}

            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Armchair size={13}/> الأثاث</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(FURNITURE_KINDS).map(([kind, meta]) => (
                    <button
                      key={kind}
                      disabled={floorRooms.length === 0}
                      onClick={() => { setSelectedOpening(null); setSelectedFurniture(null); setMovingFurnitureId(null); setPlaceMode((m) => (m === `furniture:${kind}` ? null : `furniture:${kind}`)); }}
                      className={`flex items-center justify-center text-center text-[10px] font-semibold rounded-md py-2 px-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${placeMode === `furniture:${kind}` ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
                {placeMode?.startsWith("furniture:") && (
                  <p className="text-[11px] text-cyan-300 mt-2 leading-relaxed">
                    {movingFurnitureId ? "دوس داخل غرفة لنقل القطعة." : "دوس داخل أي غرفة لوضع القطعة."}
                  </p>
                )}
                {selectedFurniture && (
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    محدد: {FURNITURE_KINDS[selectedFurniture.kind]?.label} — دوس "نقل" أو "تدوير" أو "حذف" بالمخطط.
                  </p>
                )}
              </div>
            )}

            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><ChevronUp size={13}/> السلالم</p>
                <button
                  onClick={() => { setSelectedOpening(null); setSelectedFurniture(null); setSelectedStair(null); setMovingStairId(null); setPlaceMode((m) => (m === "stairs" ? null : "stairs")); }}
                  className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-2 border transition-colors ${placeMode === "stairs" ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}
                >
                  سلم+ (من {floorLabel(currentFloor)} لـ {floorLabel(currentFloor + 1)})
                </button>
                {placeMode === "stairs" && (
                  <p className="text-[11px] text-cyan-300 mt-2 leading-relaxed">
                    {movingStairId ? "دوس بأي مكان على الشبكة لنقل السلم." : "دوس بأي مكان على الشبكة لوضع السلم."}
                  </p>
                )}
                {selectedStair && (
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    محدد: سلم — دوس "نقل" أو "تدوير" أو "حذف" بالمخطط.
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">لون الأرضية للغرفة القادمة</p>
              <div className="flex flex-wrap gap-2">
                {ROOM_COLORS.map((c) => (
                  <button key={c.hex} title={c.name} onClick={() => setRoomColor(c.hex)} style={{ backgroundColor: c.hex }}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${roomColor === c.hex ? "border-white scale-110" : "border-slate-700"}`} />
                ))}
              </div>
            </div>

            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2">لون جدران {floorLabel(currentFloor)}</p>
                <div className="flex gap-2">
                  {WALL_COLORS.map((c) => (
                    <button key={c.hex} title={c.name} disabled={floorRooms.length === 0} onClick={() => setFloorWallColor(c.hex)} style={{ backgroundColor: c.hex }}
                      className={`w-7 h-7 rounded-full border-2 transition-transform disabled:opacity-40 disabled:cursor-not-allowed ${currentFloorWallColor() === c.hex ? "border-cyan-500 scale-110" : "border-slate-700"}`} />
                  ))}
                </div>
              </div>
            )}

            {view === "plan" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Ruler size={13}/> ارتفاع جدران {floorLabel(currentFloor)}</p>
                <input
                  type="range" min="2" max="4.5" step="0.1"
                  value={currentFloorWallHeight()}
                  disabled={floorRooms.length === 0}
                  onChange={(e) => previewFloorWallHeight(parseFloat(e.target.value))}
                  onMouseUp={(e) => commitFloorWallHeight(parseFloat(e.target.value))}
                  onTouchEnd={(e) => commitFloorWallHeight(parseFloat(e.target.value))}
                  className="w-full disabled:opacity-40"
                />
                <p className="text-[11px] font-mono text-slate-400 mt-1">{currentFloorWallHeight().toFixed(1)} م</p>
              </div>
            )}

            {view === "3d" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2">جولة 360°</p>
                <button onClick={() => setAutoRotate((a) => !a)}
                  className={`w-full flex items-center justify-center gap-2 text-sm font-semibold rounded-md py-2 transition-colors ${autoRotate ? "bg-cyan-500 text-slate-950" : "bg-slate-800 hover:bg-slate-700 border border-slate-700"}`}>
                  {autoRotate ? <PauseCircle size={16}/> : <PlayCircle size={16}/>}
                  {autoRotate ? "إيقاف الدوران التلقائي" : "تشغيل الدوران التلقائي"}
                </button>
              </div>
            )}

            {view === "3d" && (
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2">سطح الغرفة</p>
                {(() => {
                  const room = rooms.find((r) => r.id === selectedId);
                  if (!room) {
                    return <p className="text-[11px] text-slate-500 leading-relaxed">اختاري غرفة من القائمة تحت لإضافة أو إزالة سطحها.</p>;
                  }
                  return (
                    <>
                      <button onClick={() => toggleRoomRoof(room.id)}
                        className={`w-full flex items-center justify-center gap-2 text-sm font-semibold rounded-md py-2 transition-colors ${room.has_roof ? "bg-cyan-500 text-slate-950" : "bg-slate-800 hover:bg-slate-700 border border-slate-700"}`}>
                        {room.has_roof ? "إزالة سطح الغرفة" : "إضافة سطح للغرفة"}
                      </button>
                      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                        الغرفة بلا سطح تظهر مكشوفة من فوق — مناسبة لشرفة أو تراس.
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400">الغرف ({floorRooms.length})</p>
                <p className="text-[11px] font-mono text-slate-500">{totalArea.toFixed(1)} م²</p>
              </div>
              <div className="space-y-1.5">
                {floorRooms.length === 0 && <p className="text-[11px] text-slate-600">لا توجد غرف بعد بهاد الطابق.</p>}
                {floorRooms.map((r) => (
                  <div key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`flex items-center justify-between rounded-md px-2.5 py-2 border cursor-pointer transition-colors ${selectedId === r.id ? "border-cyan-500 bg-slate-800/80" : "border-slate-800 bg-slate-900/60 hover:bg-slate-800/60"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <div className="min-w-0">
                        <select
                          value={r.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => renameRoom(r.id, e.target.value)}
                          className="text-xs font-semibold bg-transparent outline-none cursor-pointer max-w-[7.5rem] -mx-0.5 px-0.5 rounded hover:bg-slate-800/80 focus:bg-slate-800 focus:border focus:border-cyan-500"
                        >
                          {ROOM_TYPES.map((t) => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
                        </select>
                        <p className="text-[10px] font-mono text-slate-500">{(r.gw * r.gh).toFixed(1)} م²</p>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteRoom(r.id); }} className="text-slate-500 hover:text-red-400 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex-1 relative bg-slate-950 overflow-auto">
            {view === "plan" ? (
              <div className="w-full h-full flex items-center justify-center p-4">
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    className="rounded-md border border-slate-800 shadow-2xl touch-none"
                    style={{ cursor: "crosshair", maxWidth: "100%", height: "auto" }}
                  />
                  {floorRooms.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <p className="text-sm text-slate-500 bg-slate-950/80 px-4 py-2 rounded-md border border-slate-800">
                        اسحب مستطيلاً على الشبكة لإنشاء أول غرفة بهاد الطابق
                      </p>
                    </div>
                  )}
                  {selectedOpening && !placeMode && (() => {
                    const room = floorRooms.find((r) => r.id === selectedOpening.roomId);
                    if (!room) return null;
                    const width = selectedOpening.kind === "door" ? DOOR_W : WIN_W;
                    const m = openingMarkPoints(room, selectedOpening.wall, selectedOpening.position, width);
                    const leftPct = clamp(((m.x1 + m.x2) / 2 / gridW) * 100, 2, 98);
                    const topPct = clamp(((m.y1 + m.y2) / 2 / gridH) * 100, 2, 98);
                    return (
                      <div
                        className="absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 -translate-y-full z-10"
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: -10 }}
                      >
                        <button onClick={() => startMoveOpening(selectedOpening)} title="نقل" className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
                          <Move size={14} />
                        </button>
                        <button onClick={() => deleteOpening(selectedOpening)} title="حذف" className="p-1.5 rounded hover:bg-red-950 text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })()}
                  {selectedFurniture && !placeMode && (() => {
                    const room = floorRooms.find((r) => r.id === selectedFurniture.roomId);
                    if (!room) return null;
                    const { d } = furnitureFootprint(selectedFurniture.kind, selectedFurniture.rotation);
                    const leftPct = clamp(((room.gx + selectedFurniture.x) / gridW) * 100, 2, 98);
                    const topPct = clamp(((room.gy + selectedFurniture.y - d / 2) / gridH) * 100, 2, 98);
                    return (
                      <div
                        className="absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 -translate-y-full z-10"
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: -10 }}
                      >
                        <button onClick={() => startMoveFurniture(selectedFurniture)} title="نقل" className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
                          <Move size={14} />
                        </button>
                        <button onClick={() => rotateFurniture(selectedFurniture)} title="تدوير" className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
                          <RotateCw size={14} />
                        </button>
                        <button onClick={() => deleteFurniture(selectedFurniture)} title="حذف" className="p-1.5 rounded hover:bg-red-950 text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })()}
                  {selectedStair && !placeMode && (() => {
                    const h = floorToFloorHeight(rooms, selectedStair.floor, wallHeight);
                    const { d } = stairEffectiveFootprint(h, selectedStair.rotation);
                    const leftPct = clamp((selectedStair.x / gridW) * 100, 2, 98);
                    const topPct = clamp(((selectedStair.y - d / 2) / gridH) * 100, 2, 98);
                    return (
                      <div
                        className="absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 -translate-y-full z-10"
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: -10 }}
                      >
                        <button onClick={() => startMoveStair(selectedStair)} title="نقل" className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
                          <Move size={14} />
                        </button>
                        <button onClick={() => rotateStair(selectedStair)} title="تدوير" className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
                          <RotateCw size={14} />
                        </button>
                        <button onClick={() => deleteStair(selectedStair)} title="حذف" className="p-1.5 rounded hover:bg-red-950 text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <Viewport3D rooms={rooms} stairs={stairsList} wallHeight={wallHeight} wallColor={wallColor} autoRotate={autoRotate} />
            )}
          </main>
        </div>
      )}
    </div>

    <div id="print-sheet">
      {printData && (
        <div dir="rtl" style={{ fontFamily: "'Tajawal', sans-serif", color: "#0f172a" }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{project.name}</h1>
            <p style={{ fontSize: 12, color: "#475569", margin: "4px 0 0" }}>
              {project.client && `العميل: ${project.client} · `}{project.land_type} · {project.city || "—"} · {project.width}×{project.depth} م
            </p>
          </div>
          {printData.floors.map((f) => (
            <div key={f.floorNum} className="print-floor-page" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{f.label}</h2>
              <img src={f.imageDataUrl} alt={f.label} style={{ maxWidth: "100%", border: "1px solid #E2E8F0" }} />
              <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #CBD5E1", textAlign: "right" }}>
                    <th style={{ padding: "4px 6px" }}>الغرفة</th>
                    <th style={{ padding: "4px 6px" }}>الأبعاد</th>
                    <th style={{ padding: "4px 6px" }}>المساحة</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rooms.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "4px 6px" }}>{r.name}</td>
                      <td style={{ padding: "4px 6px" }}>{r.gw.toFixed(1)} × {r.gh.toFixed(1)} م</td>
                      <td style={{ padding: "4px 6px" }}>{(r.gw * r.gh).toFixed(1)} م²</td>
                    </tr>
                  ))}
                  {f.rooms.length === 0 && (
                    <tr><td colSpan={3} style={{ padding: "4px 6px", color: "#94A3B8" }}>لا توجد غرف بهاد الطابق.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
