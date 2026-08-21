"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Layers, Trash2, RotateCw, PlayCircle, PauseCircle, Ruler, Sparkles, X, PencilRuler,
  FolderPlus, ChevronDown, ChevronUp, Plus,
  Loader2, AlertTriangle, LogOut, AppWindow, DoorOpen, Printer, Folders, Move, Armchair, Undo2, Redo2, FileDown,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { DOOR_W, WIN_W, computeSharedBoundaries, sharedWallRanges, FURNITURE_KINDS, stairFootprint, roomArea } from "../lib/build3d";
import {
  PPM, snap, clamp, floorLabel, FLOOR_CAP,
  hitTestWalls, hitTestOpenings, openingMarkPoints, drawRoomDimensions, drawDoorSwing, drawStairSymbol,
  furnitureFootprint, hitTestFurniture, hitTestRoomForFurniture,
  floorToFloorHeight, stairEffectiveFootprint, hitTestStairs, hitTestGridForStair,
  drawFloorPlanImage, toolbarPlacement,
} from "../lib/planGeometry";
import { exportFloorsToDxf } from "../lib/dxfExport";
import { MATERIALS } from "../lib/materials";
import Viewport3D from "./Viewport3D";
import ProjectSetup from "./ProjectSetup";
import PhaseTracker from "./PhaseTracker";
import PreciseMeasurePanel from "./PreciseMeasurePanel";

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

const ROOM_TYPES = ["غرفة نوم", "صالة", "جلوس", "مضافة", "مطبخ", "حمام", "مدخل", "موزع", "تواليت", "شرفة"];

// تجميع كتالوج الأثاث حسب category (نفس ترتيب أول ظهور بـ FURNITURE_KINDS) — لعرضه مبوّب
// بواجهة الاختيار بدل قائمة مسطحة، أنسب لكتالوج بحجم عشرات القطع
const FURNITURE_GROUPS = Object.entries(FURNITURE_KINDS).reduce((groups, [kind, meta]) => {
  let g = groups.find((x) => x.category === meta.category);
  if (!g) { g = { category: meta.category, items: [] }; groups.push(g); }
  g.items.push([kind, meta]);
  return groups;
}, []);

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
  const [toasts, setToasts] = useState([]); // [{id, message}] — إشعارات فشل الحفظ (الحالة المحلية اتغيّرت بس الكتابة لقاعدة البيانات فشلت)

  function notifyError(action, error) {
    console.error(action, error);
    const id = Date.now() + Math.random();
    const detail = error?.message ? ` (${error.message})` : "";
    setToasts((prev) => [...prev, { id, text: `فشل: ${action}${detail} — تحقق من اتصالك وحاول مرة تانية` }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const [rooms, setRooms] = useState([]);
  const [stairsList, setStairsList] = useState([]);
  const [wallHeight, setWallHeight] = useState(2.7);
  const [roomColor, setRoomColor] = useState(ROOM_COLORS[0].hex);
  const [wallColor, setWallColor] = useState(WALL_COLORS[0].hex);
  const [wallMaterial, setWallMaterial] = useState("plaster");
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
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);
  const [polygonDrawMode, setPolygonDrawMode] = useState(false);

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
    } else {
      setPolygonDrawMode(false);
      polygonDraftRef.current = [];
      polygonHoverRef.current = null;
    }
  }, [placeMode]);

  const sharedBoundaries = useMemo(() => computeSharedBoundaries(rooms.filter((r) => !r.points)), [rooms]);
  const sharedRanges = useMemo(() => sharedWallRanges(sharedBoundaries), [sharedBoundaries]);

  const canvasRef = useRef(null);
  const draftRef = useRef(null);
  const draggingRef = useRef(false);
  const hoverRef = useRef(null); // {roomId, wall, position} أثناء وضع الإضافة
  const polygonDraftRef = useRef([]); // نقاط الشكل الحر المتراكمة أثناء الرسم (بالمتر)
  const polygonHoverRef = useRef(null); // موضع الفأرة الحالي — لرسم الخط "المطاطي" لآخر نقطة

  // ====== سجل التراجع/الإعادة (Undo/Redo) ======
  // لقطة = نسخة كاملة من rooms (بأبوابها/نوافذها/أثاثها المتداخل) + قائمة السلالم لحظة معيّنة.
  // pushHistory() بتُستدعى بأول سطر بكل دالة تعديل تصميم (قبل أي setState)، فبتلتقط الحالة
  // "قبل" التعديل. التراجع/الإعادة بيرجعوا اللقطة محلياً فوراً، وبالتوازي بيحسبوا الفرق
  // (إدراج/تحديث/حذف) بين الحالة الحالية واللقطة المستهدفة ويطبّقوه على قاعدة البيانات —
  // نفس جداول وأعمدة العمليات العادية تماماً، بلا مسار خاص.
  const HISTORY_LIMIT = 50;
  const historyRef = useRef({ past: [], future: [] });
  const [historyVersion, setHistoryVersion] = useState(0);
  const wallHeightDragActiveRef = useRef(false); // بوابة pushHistory وحيدة لبداية سحب شريط الارتفاع (المعاينة بتتكرر كتير أثناء السحب)

  useEffect(() => {
    historyRef.current = { past: [], future: [] };
    setHistoryVersion((v) => v + 1);
  }, [project?.id]);

  function takeSnapshot() {
    return {
      rooms: rooms.map((r) => ({ ...r, openings: (r.openings || []).map((o) => ({ ...o })), furniture: (r.furniture || []).map((f) => ({ ...f })) })),
      stairs: stairsList.map((s) => ({ ...s })),
    };
  }

  function pushHistory() {
    const h = historyRef.current;
    h.past.push(takeSnapshot());
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    setHistoryVersion((v) => v + 1);
  }

  async function syncRows(table, before, after) {
    const beforeMap = new Map(before.map((x) => [x.id, x]));
    const afterMap = new Map(after.map((x) => [x.id, x]));
    const ops = [];
    for (const b of before) if (!afterMap.has(b.id)) ops.push(supabase.from(table).delete().eq("id", b.id));
    for (const a of after) {
      const b = beforeMap.get(a.id);
      if (!b) ops.push(supabase.from(table).insert(a));
      else if (JSON.stringify(b) !== JSON.stringify(a)) ops.push(supabase.from(table).update(a).eq("id", a.id));
    }
    const results = await Promise.all(ops);
    results.forEach(({ error }) => { if (error) notifyError("مزامنة التراجع/الإعادة", error); });
  }

  async function restoreSnapshot(before, target) {
    setRooms(target.rooms);
    setStairsList(target.stairs);
    setSelectedId(null);
    setSelectedOpening(null);
    setSelectedFurniture(null);
    setSelectedStair(null);
    setPlaceMode(null);

    const strip = (r) => { const { openings, furniture, ...rest } = r; return rest; };
    const beforeRoomMap = new Map(before.rooms.map((r) => [r.id, r]));
    const targetRoomMap = new Map(target.rooms.map((r) => [r.id, r]));
    const roomOps = [];
    for (const r of before.rooms) if (!targetRoomMap.has(r.id)) roomOps.push(supabase.from("rooms").delete().eq("id", r.id));
    for (const r of target.rooms) {
      const b = beforeRoomMap.get(r.id);
      const aRow = strip(r);
      if (!b) roomOps.push(supabase.from("rooms").insert(aRow));
      else if (JSON.stringify(strip(b)) !== JSON.stringify(aRow)) roomOps.push(supabase.from("rooms").update(aRow).eq("id", r.id));
    }
    const roomResults = await Promise.all(roomOps);
    roomResults.forEach(({ error }) => { if (error) notifyError("مزامنة التراجع/الإعادة", error); });

    // بعد ما صارت صفوف الغرف مطابقة (الغرف المُعادة-إدراجها موجودة فعلياً)، منزامن أبواب/نوافذ/أثاث كل غرفة
    for (const r of target.rooms) {
      const b = beforeRoomMap.get(r.id);
      await syncRows("openings", b?.openings || [], r.openings || []);
      await syncRows("furniture", b?.furniture || [], r.furniture || []);
    }
    await syncRows("stairs", before.stairs, target.stairs);
  }

  async function undo() {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const current = takeSnapshot();
    const target = h.past.pop();
    h.future.push(current);
    if (h.future.length > HISTORY_LIMIT) h.future.shift();
    setHistoryVersion((v) => v + 1);
    await restoreSnapshot(current, target);
  }

  async function redo() {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const current = takeSnapshot();
    const target = h.future.pop();
    h.past.push(current);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    setHistoryVersion((v) => v + 1);
    await restoreSnapshot(current, target);
  }

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const gridW = project ? clamp(project.width, 6, 60) : 20;
  const gridH = project ? clamp(project.depth, 6, 60) : 15;

  const drawPlan = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);

    for (let x = 0; x <= gridW; x++) {
      ctx.strokeStyle = x % 5 === 0 ? "#D8D8DC" : "#EDEDF0";
      ctx.lineWidth = x % 5 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x * PPM + 0.5, 0);
      ctx.lineTo(x * PPM + 0.5, gridH * PPM);
      ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
      ctx.strokeStyle = y % 5 === 0 ? "#D8D8DC" : "#EDEDF0";
      ctx.lineWidth = y % 5 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y * PPM + 0.5);
      ctx.lineTo(gridW * PPM, y * PPM + 0.5);
      ctx.stroke();
    }

    const floorRoomsList = rooms.filter((r) => (r.floor ?? 0) === currentFloor);

    floorRoomsList.forEach((r) => {
      const x = r.gx * PPM, y = r.gy * PPM, rw = r.gw * PPM, rh = r.gh * PPM;

      if (r.points && r.points.length >= 3) {
        ctx.beginPath();
        r.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * PPM, p.y * PPM);
          else ctx.lineTo(p.x * PPM, p.y * PPM);
        });
        ctx.closePath();
        ctx.fillStyle = r.color + "30";
        ctx.fill();
        ctx.strokeStyle = r.id === selectedId ? "#22D3EE" : r.color;
        ctx.lineWidth = r.id === selectedId ? 3 : 2;
        ctx.stroke();
        ctx.fillStyle = "#1A1A1D";
        ctx.font = "700 13px Tajawal, sans-serif";
        ctx.fillText(r.name, x + 8, y + 20);
        ctx.fillStyle = "#6B6B72";
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.fillText(`${roomArea(r).toFixed(1)} م²`, x + 8, y + 36);
      } else {
        ctx.fillStyle = r.color + "30";
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeStyle = r.id === selectedId ? "#22D3EE" : r.color;
        ctx.lineWidth = r.id === selectedId ? 3 : 2;
        ctx.strokeRect(x, y, rw, rh);
        ctx.fillStyle = "#1A1A1D";
        ctx.font = "700 13px Tajawal, sans-serif";
        ctx.fillText(r.name, x + 8, y + 20);
        ctx.fillStyle = "#6B6B72";
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.fillText(`${r.gw.toFixed(1)} × ${r.gh.toFixed(1)} m`, x + 8, y + 36);
        if (showDimensions) drawRoomDimensions(ctx, r, { line: "#B45309", text: "#92400E" });
      }

      (r.openings || []).forEach((o) => {
        const width = o.kind === "door" ? DOOR_W : WIN_W;
        const m = openingMarkPoints(r, o, width);
        ctx.strokeStyle = o.kind === "door" ? "#8B5A2B" : "#9FD8E8";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(m.x1 * PPM, m.y1 * PPM);
        ctx.lineTo(m.x2 * PPM, m.y2 * PPM);
        ctx.stroke();
        drawDoorSwing(ctx, r, o, "#C88A5A");
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
        ctx.fillStyle = "#1A1A1D";
        ctx.font = "10px Tajawal, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(FURNITURE_KINDS[f.kind]?.label || "", fx + (w * PPM) / 2, fy + (fd * PPM) / 2 + 3);
        ctx.textAlign = "start";
      });
    });

    stairsList.filter((s) => (s.floor ?? 0) === currentFloor).forEach((s) => {
      const h = floorToFloorHeight(rooms, currentFloor, wallHeight);
      const rotation = s.rotation || 0;
      const { numSteps } = stairFootprint(h);
      const { w: fw, d: fd } = stairEffectiveFootprint(h, rotation);
      const sx = (s.x - fw / 2) * PPM, sy = (s.y - fd / 2) * PPM;
      const isSel = selectedStair?.id === s.id;
      ctx.fillStyle = isSel ? "#22D3EE55" : "#6B6B7244";
      ctx.fillRect(sx, sy, fw * PPM, fd * PPM);
      ctx.strokeStyle = isSel ? "#22D3EE" : "#6B6B72";
      ctx.lineWidth = isSel ? 2 : 1.5;
      ctx.strokeRect(sx, sy, fw * PPM, fd * PPM);
      drawStairSymbol(ctx, sx, sy, fw, fd, rotation, numSteps, isSel ? "#22D3EE" : "#6B6B72");
      ctx.fillStyle = "#1A1A1D";
      ctx.font = "10px Tajawal, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("سلم", sx + (fw * PPM) / 2, sy + (fd * PPM) / 2 + 3);
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

    if (polygonDrawMode) {
      const pts = polygonDraftRef.current;
      if (pts.length > 0) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#22D3EE";
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * PPM, p.y * PPM);
          else ctx.lineTo(p.x * PPM, p.y * PPM);
        });
        const hov = polygonHoverRef.current;
        if (hov) ctx.lineTo(hov.x * PPM, hov.y * PPM);
        ctx.stroke();
        ctx.setLineDash([]);
        pts.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x * PPM, p.y * PPM, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#22D3EE";
          ctx.fill();
        });
      }
    }

    if ((placeMode === "door" || placeMode === "window") && hoverRef.current) {
      const room = floorRoomsList.find((r) => r.id === hoverRef.current.roomId);
      if (room) {
        const width = placeMode === "door" ? DOOR_W : WIN_W;
        const m = openingMarkPoints(room, hoverRef.current, width);
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
  }, [rooms, selectedId, selectedFurniture, stairsList, selectedStair, wallHeight, gridW, gridH, placeMode, currentFloor, polygonDrawMode, showDimensions]);

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

  // إحداثيات الرسم (مستطيل أو شكل حر) — ملتصقة بالشبكة أو خام حسب مفتاح "الصق بالشبكة"
  function getMeterCoordsForDraw(e) {
    return snapEnabled ? getMeterCoords(e) : getMeterCoordsRaw(e);
  }

  function handlePointerDown(e) {
    if (polygonDrawMode) {
      const { x, y } = getMeterCoordsForDraw(e);
      const pts = polygonDraftRef.current;
      if (pts.length >= 3) {
        const first = pts[0];
        if (Math.hypot(x - first.x, y - first.y) < 0.3) {
          finishPolygonDraw();
          return;
        }
      }
      polygonDraftRef.current = [...pts, { x, y }];
      drawPlan();
      return;
    }
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
      if (hit) placeOpening(hit, placeMode);
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
    const { x, y } = getMeterCoordsForDraw(e);
    draggingRef.current = true;
    draftRef.current = { sx: x, sy: y, ex: x, ey: y };
    setSelectedId(null);
  }
  function handlePointerMove(e) {
    if (polygonDrawMode) {
      polygonHoverRef.current = getMeterCoordsForDraw(e);
      drawPlan();
      return;
    }
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
    const { x, y } = getMeterCoordsForDraw(e);
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
      pushHistory();
      const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          project_id: project.id, name: ROOM_TYPES[0], gx, gy, gw, gh, color: roomColor, floor: currentFloor, has_roof: false,
          wall_height: floorRoomsNow[0]?.wall_height ?? null,
          wall_color: floorRoomsNow[0]?.wall_color ?? null,
          wall_material: floorRoomsNow[0]?.wall_material ?? null,
        })
        .select("*, openings(*), furniture(*)")
        .single();
      if (error) { notifyError("إنشاء الغرفة", error); drawPlan(); return; }
      setRooms((prev) => [...prev, data]);
    } else {
      drawPlan();
    }
  }

  // بيقفل رسم الشكل الحر — بيدرج غرفة جديدة بالنقاط الفعلية + مربط إحاطة (bounding box)
  // محسوب منها لتوافق كل الكود يلي بيقرأ gx/gy/gw/gh (نفس نمط وراثة ارتفاع/لون الجدار
  // بإنشاء الغرف المستطيلة العادية)
  async function finishPolygonDraw() {
    const pts = polygonDraftRef.current;
    if (pts.length < 3 || !project) return;
    pushHistory();
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const gx = Math.min(...xs), gy = Math.min(...ys);
    const gw = Math.max(0.1, Math.max(...xs) - gx);
    const gh = Math.max(0.1, Math.max(...ys) - gy);
    const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
    polygonDraftRef.current = [];
    polygonHoverRef.current = null;
    setPolygonDrawMode(false);
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        project_id: project.id, name: ROOM_TYPES[0], gx, gy, gw, gh, color: roomColor, floor: currentFloor,
        has_roof: false, points: pts,
        wall_height: floorRoomsNow[0]?.wall_height ?? null,
        wall_color: floorRoomsNow[0]?.wall_color ?? null,
        wall_material: floorRoomsNow[0]?.wall_material ?? null,
      })
      .select("*, openings(*), furniture(*)")
      .single();
    if (error) { notifyError("إنشاء الغرفة الحرة", error); drawPlan(); return; }
    setRooms((prev) => [...prev, data]);
    drawPlan();
  }

  function cancelPolygonDraw() {
    polygonDraftRef.current = [];
    polygonHoverRef.current = null;
    setPolygonDrawMode(false);
    drawPlan();
  }

  function startPolygonDraw() {
    setPlaceMode(null);
    setSelectedOpening(null);
    setSelectedFurniture(null);
    setSelectedStair(null);
    setSelectedId(null);
    polygonDraftRef.current = [];
    polygonHoverRef.current = null;
    setPolygonDrawMode(true);
  }

  async function updateRoomBounds(id, patch) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("rooms").update(patch).eq("id", id);
    if (error) notifyError("تحديث قياسات الغرفة", error);
  }

  async function placeOpening(hit, kind) {
    pushHistory();
    const { roomId, position, wall, edgeIndex } = hit;
    // إما جدار مستطيل مسمّى (wall) أو ضلع شكل حر (edge_index) — نفس قيد قاعدة البيانات
    const wallFields = edgeIndex != null ? { wall: null, edge_index: edgeIndex } : { wall, edge_index: null };

    if (movingOpeningId) {
      const openingId = movingOpeningId;
      const { data, error } = await supabase
        .from("openings")
        .update({ room_id: roomId, ...wallFields, position })
        .eq("id", openingId)
        .select()
        .single();
      if (error) { notifyError("نقل الباب/النافذة", error); return; }
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
      .insert({ room_id: roomId, ...wallFields, kind, position })
      .select()
      .single();
    if (error) { notifyError("إضافة الباب/النافذة", error); return; }
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, openings: [...(r.openings || []), data] } : r)));
    // نضل بوضع الإضافة (بلا setPlaceMode(null)) — تسمح بإضافة أكتر من باب/نافذة ورا بعض
    // بلا ما يحتاج المستخدم يدوس الزر من جديد كل مرة؛ يطلع من الوضع يدوياً بدوسة تانية عالزر
    drawPlan();
  }

  async function deleteOpening(opening) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === opening.roomId ? { ...r, openings: (r.openings || []).filter((o) => o.id !== opening.id) } : r)));
    setSelectedOpening(null);
    const { error } = await supabase.from("openings").delete().eq("id", opening.id);
    if (error) notifyError("حذف الباب/النافذة", error);
  }

  function startMoveOpening(opening) {
    setSelectedOpening(null);
    setMovingOpeningId(opening.id);
    setPlaceMode(opening.kind);
  }

  async function placeFurniture(roomId, kind, x, y) {
    pushHistory();
    if (movingFurnitureId) {
      const furnitureId = movingFurnitureId;
      const { data, error } = await supabase
        .from("furniture")
        .update({ room_id: roomId, x, y })
        .eq("id", furnitureId)
        .select()
        .single();
      if (error) { notifyError("نقل الأثاث", error); return; }
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
    if (error) { notifyError("إضافة الأثاث", error); return; }
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, furniture: [...(r.furniture || []), data] } : r)));
    // نضل بوضع الإضافة (بلا setPlaceMode(null)) — نفس منطق الأبواب/النوافذ، تسمح بإضافة
    // أكتر من قطعة ورا بعض بلا داعي لإعادة الضغط على الزر كل مرة
    drawPlan();
  }

  async function deleteFurniture(item) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === item.roomId ? { ...r, furniture: (r.furniture || []).filter((f) => f.id !== item.id) } : r)));
    setSelectedFurniture(null);
    const { error } = await supabase.from("furniture").delete().eq("id", item.id);
    if (error) notifyError("حذف الأثاث", error);
  }

  function startMoveFurniture(item) {
    setSelectedFurniture(null);
    setMovingFurnitureId(item.id);
    setPlaceMode(`furniture:${item.kind}`);
  }

  async function rotateFurniture(item) {
    pushHistory();
    const nextRotation = (item.rotation + 90) % 360;
    setRooms((prev) => prev.map((r) => (r.id === item.roomId ? { ...r, furniture: (r.furniture || []).map((f) => (f.id === item.id ? { ...f, rotation: nextRotation } : f)) } : r)));
    setSelectedFurniture((s) => (s && s.id === item.id ? { ...s, rotation: nextRotation } : s));
    const { error } = await supabase.from("furniture").update({ rotation: nextRotation }).eq("id", item.id);
    if (error) notifyError("تدوير الأثاث", error);
  }

  async function placeStair(floor, x, y) {
    if (!project) return;
    pushHistory();
    if (movingStairId) {
      const stairId = movingStairId;
      const { data, error } = await supabase
        .from("stairs")
        .update({ floor, x, y })
        .eq("id", stairId)
        .select()
        .single();
      if (error) { notifyError("نقل السلم", error); return; }
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
    if (error) { notifyError("إضافة السلم", error); return; }
    setStairsList((prev) => [...prev, data]);
    // نضل بوضع الإضافة (نفس منطق الأبواب/النوافذ/الأثاث)
    drawPlan();
  }

  async function deleteStair(stair) {
    pushHistory();
    setStairsList((prev) => prev.filter((s) => s.id !== stair.id));
    setSelectedStair(null);
    const { error } = await supabase.from("stairs").delete().eq("id", stair.id);
    if (error) notifyError("حذف السلم", error);
  }

  function startMoveStair(stair) {
    setSelectedStair(null);
    setMovingStairId(stair.id);
    setPlaceMode("stairs");
  }

  async function rotateStair(stair) {
    pushHistory();
    const nextRotation = (stair.rotation + 90) % 360;
    setStairsList((prev) => prev.map((s) => (s.id === stair.id ? { ...s, rotation: nextRotation } : s)));
    setSelectedStair((s) => (s && s.id === stair.id ? { ...s, rotation: nextRotation } : s));
    const { error } = await supabase.from("stairs").update({ rotation: nextRotation }).eq("id", stair.id);
    if (error) notifyError("تدوير السلم", error);
  }

  async function renameRoom(id, name) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    const { error } = await supabase.from("rooms").update({ name }).eq("id", id);
    if (error) notifyError("إعادة تسمية الغرفة", error);
  }

  async function deleteRoom(id) {
    pushHistory();
    setRooms((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    const { error } = await supabase.from("rooms").delete().eq("id", id);
    if (error) notifyError("حذف الغرفة", error);
  }

  async function toggleRoomRoof(id) {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    pushHistory();
    const hasRoof = !room.has_roof;
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, has_roof: hasRoof } : r)));
    const { error } = await supabase.from("rooms").update({ has_roof: hasRoof }).eq("id", id);
    if (error) notifyError("تبديل سطح الغرفة", error);
  }

  async function setRoomRoofType(id, roofType) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, roof_type: roofType } : r)));
    const { error } = await supabase.from("rooms").update({ roof_type: roofType }).eq("id", id);
    if (error) notifyError("تبديل نوع السطح", error);
  }

  async function clearRooms() {
    if (!project) return;
    pushHistory();
    setRooms((prev) => prev.filter((r) => (r.floor ?? 0) !== currentFloor));
    setSelectedId(null);
    const { error } = await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", currentFloor);
    if (error) notifyError("حذف كل غرف الطابق", error);
  }

  async function deleteFloor() {
    if (!project || currentFloor === 0) return;
    pushHistory();
    const floorToDelete = currentFloor;
    setRooms((prev) => prev.filter((r) => (r.floor ?? 0) !== floorToDelete));
    setConfirmDeleteFloor(false);
    setCurrentFloor(0);
    const { error } = await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", floorToDelete);
    if (error) notifyError("حذف الطابق", error);
  }

  const FLOOR_SWAP_SENTINEL = -999; // قيمة مستحيلة كرقم طابق حقيقي (الطوابق 0..FLOOR_CAP بس)

  async function swapFloors(fromFloor, toFloor) {
    if (!project || toFloor < 0 || toFloor > FLOOR_CAP || toFloor === fromFloor) return;
    pushHistory();

    let res = await supabase.from("rooms").update({ floor: FLOOR_SWAP_SENTINEL }).eq("project_id", project.id).eq("floor", fromFloor);
    if (res.error) { notifyError("تبديل ترتيب الطوابق", res.error); return; }

    res = await supabase.from("rooms").update({ floor: fromFloor }).eq("project_id", project.id).eq("floor", toFloor);
    if (res.error) {
      notifyError("تبديل ترتيب الطوابق", res.error);
      await supabase.from("rooms").update({ floor: fromFloor }).eq("project_id", project.id).eq("floor", FLOOR_SWAP_SENTINEL);
      return;
    }

    res = await supabase.from("rooms").update({ floor: toFloor }).eq("project_id", project.id).eq("floor", FLOOR_SWAP_SENTINEL);
    if (res.error) { notifyError("تبديل ترتيب الطوابق (يرجى إعادة تحميل الصفحة والتحقق من الطوابق)", res.error); return; }

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
    pushHistory();
    const floorRoomsNow = rooms.filter((r) => (r.floor ?? 0) === currentFloor);
    const inheritedHeight = floorRoomsNow[0]?.wall_height ?? null;
    const inheritedColor = floorRoomsNow[0]?.wall_color ?? null;
    const inheritedMaterial = floorRoomsNow[0]?.wall_material ?? null;
    const sample = [
      { project_id: project.id, name: "صالة", gx: 1, gy: 1, gw: 6, gh: 5, color: ROOM_COLORS[0].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor, wall_material: inheritedMaterial },
      { project_id: project.id, name: "مطبخ", gx: 7.5, gy: 1, gw: 4, gh: 5, color: ROOM_COLORS[1].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor, wall_material: inheritedMaterial },
      { project_id: project.id, name: "غرفة نوم", gx: 1, gy: 6.5, gw: 5, gh: 4, color: ROOM_COLORS[2].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor, wall_material: inheritedMaterial },
      { project_id: project.id, name: "حمام", gx: 6.5, gy: 6.5, gw: 3, gh: 4, color: ROOM_COLORS[3].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor, wall_material: inheritedMaterial },
    ];
    await supabase.from("rooms").delete().eq("project_id", project.id).eq("floor", currentFloor);
    const { data, error } = await supabase.from("rooms").insert(sample).select("*, openings(*), furniture(*)");
    if (error) { notifyError("تحميل النموذج الجاهز", error); return; }
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
        try {
          const [phasesData, roomsRes, stairsRes] = await Promise.all([
            fetchPhasesForProject(proj.id),
            supabase.from("rooms").select("*, openings(*), furniture(*)").eq("project_id", proj.id),
            supabase.from("stairs").select("*").eq("project_id", proj.id),
          ]);
          if (cancelled) return;
          if (roomsRes.error) throw roomsRes.error;
          if (stairsRes.error) throw stairsRes.error;
          setProject(proj);
          setPhases(phasesData);
          setRooms(roomsRes.data || []);
          setStairsList(stairsRes.data || []);
          setWallHeight(proj.wall_height);
          setWallColor(proj.wall_color);
          setWallMaterial(proj.wall_material);
        } catch (err) {
          if (!cancelled) setLoadError(err.message || "تعذر تحميل بيانات المشروع");
        }
      }
      if (!cancelled) setInitializing(false);
    }
    loadInitial();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "plan") {
      setPlaceMode(null);
      hoverRef.current = null;
      setPolygonDrawMode(false);
      polygonDraftRef.current = [];
      polygonHoverRef.current = null;
    }
  }, [view]);

  useEffect(() => {
    setPlaceMode(null);
    hoverRef.current = null;
    setPolygonDrawMode(false);
    polygonDraftRef.current = [];
    polygonHoverRef.current = null;
    setSelectedId(null);
    setConfirmDeleteFloor(false);
  }, [currentFloor]);

  useEffect(() => {
    if (printData) window.print();
  }, [printData]);

  function computeFloorsMeta() {
    const floorNums = [...new Set(rooms.map((r) => r.floor ?? 0))].sort((a, b) => a - b);
    return (floorNums.length ? floorNums : [0]).map((f) => ({
      floorNum: f,
      label: floorLabel(f),
      rooms: rooms.filter((r) => (r.floor ?? 0) === f),
    }));
  }

  function handlePrint() {
    if (!project) return;
    const floors = computeFloorsMeta().map((f) => ({ ...f, imageDataUrl: drawFloorPlanImage(f.rooms, gridW, gridH) }));
    setPrintData({ floors });
  }

  function handleExportDxf() {
    if (!project) return;
    const dxfString = exportFloorsToDxf(rooms, computeFloorsMeta(), stairsList, wallHeight, showDimensions);
    const blob = new Blob([dxfString], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "مخطط"}.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) notifyError("تسجيل الخروج", error);
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
    setWallMaterial(proj.wall_material);
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
    try {
      const [phasesData, roomsRes, stairsRes] = await Promise.all([
        fetchPhasesForProject(proj.id),
        supabase.from("rooms").select("*, openings(*), furniture(*)").eq("project_id", proj.id),
        supabase.from("stairs").select("*").eq("project_id", proj.id),
      ]);
      if (roomsRes.error) throw roomsRes.error;
      if (stairsRes.error) throw stairsRes.error;
      setProject(proj);
      setPhases(phasesData);
      setRooms(roomsRes.data || []);
      setStairsList(stairsRes.data || []);
      setWallHeight(proj.wall_height);
      setWallColor(proj.wall_color);
      setWallMaterial(proj.wall_material);
      setSelectedId(null);
      setCurrentFloor(0);
      setConfirmReset(false);
      setView("phases");
    } catch (err) {
      notifyError("تحميل المشروع", err);
    } finally {
      setInitializing(false);
    }
  }

  function currentFloorWallHeight() {
    const room = rooms.find((r) => (r.floor ?? 0) === currentFloor);
    return room?.wall_height ?? wallHeight;
  }
  function currentFloorWallColor() {
    const room = rooms.find((r) => (r.floor ?? 0) === currentFloor);
    return room?.wall_color ?? wallColor;
  }
  function currentFloorWallMaterial() {
    const room = rooms.find((r) => (r.floor ?? 0) === currentFloor);
    return room?.wall_material ?? wallMaterial;
  }

  // معاينة حية أثناء سحب شريط الارتفاع — تحديث محلي بس، بلا كتابة لقاعدة البيانات
  function previewFloorWallHeight(value) {
    if (!wallHeightDragActiveRef.current) {
      wallHeightDragActiveRef.current = true;
      pushHistory();
    }
    setRooms((prev) => prev.map((r) => ((r.floor ?? 0) === currentFloor ? { ...r, wall_height: value } : r)));
  }

  async function commitFloorWallHeight(value) {
    wallHeightDragActiveRef.current = false;
    if (!project || floorRooms.length === 0) return;
    const { error } = await supabase.from("rooms").update({ wall_height: value }).eq("project_id", project.id).eq("floor", currentFloor);
    if (error) notifyError("تحديث ارتفاع الجدران", error);
  }

  async function setFloorWallColor(hex) {
    if (!project || floorRooms.length === 0) return;
    pushHistory();
    setRooms((prev) => prev.map((r) => ((r.floor ?? 0) === currentFloor ? { ...r, wall_color: hex } : r)));
    const { error } = await supabase.from("rooms").update({ wall_color: hex }).eq("project_id", project.id).eq("floor", currentFloor);
    if (error) notifyError("تحديث لون الجدران", error);
  }

  async function setFloorWallMaterial(material) {
    if (!project || floorRooms.length === 0) return;
    pushHistory();
    setRooms((prev) => prev.map((r) => ((r.floor ?? 0) === currentFloor ? { ...r, wall_material: material } : r)));
    const { error } = await supabase.from("rooms").update({ wall_material: material }).eq("project_id", project.id).eq("floor", currentFloor);
    if (error) notifyError("تحديث مادة الجدران", error);
  }

  async function updateRoomColor(id, hex) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, color: hex } : r)));
    const { error } = await supabase.from("rooms").update({ color: hex }).eq("id", id);
    if (error) notifyError("تحديث لون أرضية الغرفة", error);
  }

  async function setRoomFloorMaterial(id, material) {
    pushHistory();
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, floor_material: material } : r)));
    const { error } = await supabase.from("rooms").update({ floor_material: material }).eq("id", id);
    if (error) notifyError("تحديث مادة الأرضية", error);
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
  const totalArea = floorRooms.reduce((s, r) => s + roomArea(r), 0);

  return (
    <>
    <div id="app-shell" dir="rtl" className="w-full h-screen flex flex-col bg-slate-950 text-slate-100" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <style>{`input[type="range"] { accent-color: #22D3EE; }`}</style>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div key={t.id} className="flex items-start gap-2 bg-red-950/95 border border-red-800 text-red-200 text-xs rounded-lg px-3 py-2.5 shadow-2xl">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <p className="flex-1 leading-relaxed">{t.text}</p>
              <button onClick={() => dismissToast(t.id)} className="text-red-400 hover:text-red-200 shrink-0"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

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
          {(view === "plan" || view === "3d") && (
            <div className="flex items-center gap-0.5 ml-1">
              <button onClick={undo} disabled={historyRef.current.past.length === 0} title="تراجع (Ctrl+Z)"
                className="flex items-center justify-center text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded-md hover:bg-slate-800">
                <Undo2 size={15} />
              </button>
              <button onClick={redo} disabled={historyRef.current.future.length === 0} title="إعادة (Ctrl+Shift+Z)"
                className="flex items-center justify-center text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded-md hover:bg-slate-800">
                <Redo2 size={15} />
              </button>
            </div>
          )}
          <button onClick={handlePrint} title="طباعة المخطط / حفظ PDF" className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5">
            <Printer size={13} /> طباعة / PDF
          </button>
          <button onClick={handleExportDxf} disabled={rooms.length === 0} title="تصدير المخطط بصيغة DXF (متوافقة مباشرة مع AutoCAD)" className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1.5">
            <FileDown size={13} /> تصدير DXF
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
          notifyError={notifyError}
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

              {view === "plan" && (
                <>
                  <button
                    onClick={() => setSnapEnabled((s) => !s)}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-2 border mt-2 transition-colors ${snapEnabled ? "bg-slate-800 hover:bg-slate-700 border-slate-700" : "bg-cyan-500 text-slate-950 border-cyan-500"}`}
                  >
                    <Ruler size={13}/> {snapEnabled ? "الصق بالشبكة: مفعّل" : "الصق بالشبكة: معطّل (دقة حرة)"}
                  </button>

                  <button
                    onClick={() => setShowDimensions((s) => !s)}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-2 border mt-2 transition-colors ${showDimensions ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}
                  >
                    <Ruler size={13}/> {showDimensions ? "إظهار القياسات: مفعّل" : "إظهار القياسات: معطّل"}
                  </button>

                  {polygonDrawMode ? (
                    <div className="flex gap-2 mt-2">
                      <button onClick={finishPolygonDraw} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-md py-2 transition-colors">
                        إنهاء الرسم
                      </button>
                      <button onClick={cancelPolygonDraw} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-2 transition-colors">
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={startPolygonDraw}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-2 mt-2 transition-colors"
                    >
                      <PencilRuler size={13}/> ارسم شكل حر
                    </button>
                  )}
                  {polygonDrawMode && (
                    <p className="text-[11px] text-cyan-300 mt-2 leading-relaxed">
                      دوس نقطة نقطة لرسم أضلاع الشكل. دوس قريب من أول نقطة أو زر "إنهاء الرسم" لإغلاقه (3 نقاط ع الأقل).
                    </p>
                  )}
                </>
              )}
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
                <div className="space-y-3">
                  {FURNITURE_GROUPS.map((g) => (
                    <div key={g.category}>
                      <p className="text-[10px] font-semibold text-slate-500 mb-1.5">{g.category}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {g.items.map(([kind, meta]) => (
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
                    </div>
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
                <p className="text-xs font-semibold text-slate-400 mb-2">مادة جدران {floorLabel(currentFloor)}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {Object.entries(MATERIALS).map(([key, m]) => (
                    <button key={key} disabled={floorRooms.length === 0} onClick={() => setFloorWallMaterial(key)}
                      className={`text-[10px] font-semibold rounded-md py-1.5 px-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${currentFloorWallMaterial() === key ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}>
                      {m.label}
                    </button>
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

            {view === "plan" && (() => {
              const room = floorRooms.find((r) => r.id === selectedId);
              if (!room || room.points) return null;
              return <PreciseMeasurePanel room={room} onCommit={(key, v) => updateRoomBounds(room.id, { [key]: v })} />;
            })()}

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
                      {room.has_roof && !room.points && (
                        <div className="mt-3">
                          <p className="text-[11px] text-slate-500 mb-1.5">نوع السطح</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setRoomRoofType(room.id, "flat")}
                              className={`text-xs font-semibold rounded-md py-1.5 transition-colors ${(room.roof_type ?? "flat") === "flat" ? "bg-cyan-500 text-slate-950" : "bg-slate-800 hover:bg-slate-700 border border-slate-700"}`}>
                              مسطح
                            </button>
                            <button onClick={() => setRoomRoofType(room.id, "gable")}
                              className={`text-xs font-semibold rounded-md py-1.5 transition-colors ${room.roof_type === "gable" ? "bg-cyan-500 text-slate-950" : "bg-slate-800 hover:bg-slate-700 border border-slate-700"}`}>
                              جملوني
                            </button>
                          </div>
                        </div>
                      )}
                      {room.has_roof && room.points && (
                        <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                          السطح الجملوني غير متاح للغرف حرة الشكل — سطح مسطح بس بالإصدار الحالي.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {view === "3d" && (() => {
              const room = rooms.find((r) => r.id === selectedId);
              if (!room) return null;
              return (
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-2">أرضية الغرفة المحددة</p>
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {ROOM_COLORS.map((c) => (
                      <button key={c.hex} title={c.name} onClick={() => updateRoomColor(room.id, c.hex)} style={{ backgroundColor: c.hex }}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${room.color === c.hex ? "border-cyan-500 scale-110" : "border-slate-700"}`} />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(MATERIALS).map(([key, m]) => (
                      <button key={key} onClick={() => setRoomFloorMaterial(room.id, key)}
                        className={`text-[10px] font-semibold rounded-md py-1.5 px-1 border transition-colors ${(room.floor_material ?? "plaster") === key ? "bg-cyan-500 text-slate-950 border-cyan-500" : "bg-slate-800 hover:bg-slate-700 border-slate-700"}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                        <p className="text-[10px] font-mono text-slate-500">{roomArea(r).toFixed(1)} م²</p>
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
                    const m = openingMarkPoints(room, selectedOpening, width);
                    const leftPct = clamp(((m.x1 + m.x2) / 2 / gridW) * 100, 2, 98);
                    const anchorM = (m.y1 + m.y2) / 2;
                    const { pct: topPct, flip } = toolbarPlacement(anchorM, anchorM, gridH);
                    return (
                      <div
                        className={`absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 z-10 ${flip ? "" : "-translate-y-full"}`}
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: flip ? 10 : -10 }}
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
                    const topM = room.gy + selectedFurniture.y - d / 2;
                    const bottomM = room.gy + selectedFurniture.y + d / 2;
                    const { pct: topPct, flip } = toolbarPlacement(topM, bottomM, gridH);
                    return (
                      <div
                        className={`absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 z-10 ${flip ? "" : "-translate-y-full"}`}
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: flip ? 10 : -10 }}
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
                    const topM = selectedStair.y - d / 2;
                    const bottomM = selectedStair.y + d / 2;
                    const { pct: topPct, flip } = toolbarPlacement(topM, bottomM, gridH);
                    return (
                      <div
                        className={`absolute flex items-center gap-1 bg-slate-900 border border-cyan-500 rounded-md shadow-xl p-1 -translate-x-1/2 z-10 ${flip ? "" : "-translate-y-full"}`}
                        style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: flip ? 10 : -10 }}
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
              <Viewport3D rooms={rooms} stairs={stairsList} wallHeight={wallHeight} wallColor={wallColor} wallMaterial={wallMaterial} autoRotate={autoRotate} />
            )}
          </main>
        </div>
      )}
    </div>

    <div id="print-sheet">
      {printData && (
        <div dir="rtl" style={{ fontFamily: "'Tajawal', sans-serif", color: "#1A1A1D" }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{project.name}</h1>
            <p style={{ fontSize: 12, color: "#68686E", margin: "4px 0 0" }}>
              {project.client && `العميل: ${project.client} · `}{project.land_type} · {project.city || "—"} · {project.width}×{project.depth} م
            </p>
          </div>
          {printData.floors.map((f) => (
            <div key={f.floorNum} className="print-floor-page" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{f.label}</h2>
              <img src={f.imageDataUrl} alt={f.label} style={{ maxWidth: "100%", border: "1px solid #E2E8F0" }} />
              <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #C7C7CC", textAlign: "right" }}>
                    <th style={{ padding: "4px 6px" }}>الغرفة</th>
                    <th style={{ padding: "4px 6px" }}>الأبعاد</th>
                    <th style={{ padding: "4px 6px" }}>المساحة</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rooms.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #EDEDF0" }}>
                      <td style={{ padding: "4px 6px" }}>{r.name}</td>
                      <td style={{ padding: "4px 6px" }}>{r.points ? "شكل حر" : `${r.gw.toFixed(1)} × ${r.gh.toFixed(1)} م`}</td>
                      <td style={{ padding: "4px 6px" }}>{roomArea(r).toFixed(1)} م²</td>
                    </tr>
                  ))}
                  {f.rooms.length === 0 && (
                    <tr><td colSpan={3} style={{ padding: "4px 6px", color: "#8E8E96" }}>لا توجد غرف بهاد الطابق.</td></tr>
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
