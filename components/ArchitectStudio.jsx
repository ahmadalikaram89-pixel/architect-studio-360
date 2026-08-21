"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Layers, Trash2, RotateCcw, RotateCw, PlayCircle, PauseCircle, Ruler, Sparkles, X,
  MapPin, PencilRuler, Building2, FileCheck2, HardHat, ClipboardCheck, KeyRound,
  CheckCircle2, Circle, Clock3, ChevronLeft, FolderPlus, ChevronDown, ChevronUp, Plus, CalendarDays, UserRound,
  Loader2, AlertTriangle, LogOut, AppWindow, DoorOpen, Printer, Folders, Move, Armchair, Undo2, Redo2,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { computeCenter, rebuildGroup, DOOR_W, WIN_W, computeSharedBoundaries, sharedWallRanges, FURNITURE_KINDS, computeFloorBaseYMap, stairFootprint, roomArea } from "../lib/build3d";

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

const ROOM_TYPES = ["غرفة نوم", "صالة", "جلوس", "مضافة", "مطبخ", "حمام", "مدخل", "موزع", "تواليت", "شرفة"];

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
    if (r.points) {
      // أضلاع الشكل الحر — بلا استبعاد جدران مشتركة (الغرف الحرة ما بتدمج جدران أصلاً)
      for (let i = 0; i < r.points.length; i++) {
        const p1 = r.points[i], p2 = r.points[(i + 1) % r.points.length];
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const { dist, t } = pointSegDist(cx, cy, p1.x, p1.y, p2.x, p2.y);
        const rawPosition = t * length;
        if (!best || dist < best.dist) best = { dist, roomId: r.id, edgeIndex: i, length, rawPosition };
      }
      return;
    }
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
  const isEdge = best.wall == null;

  const room = rooms.find((r) => r.id === best.roomId);
  const existing = (room.openings || []).filter((o) =>
    (isEdge ? o.edge_index === best.edgeIndex : o.wall === best.wall) && o.id !== excludeOpeningId
  );
  const overlaps = existing.some((o) => {
    const ow = o.kind === "door" ? DOOR_W : WIN_W;
    return position - half < o.position + ow / 2 && position + half > o.position - ow / 2;
  });
  if (overlaps) return null;

  return isEdge
    ? { roomId: best.roomId, edgeIndex: best.edgeIndex, position }
    : { roomId: best.roomId, wall: best.wall, position };
}

// بيلاقي أقرب فتحة (باب/نافذة) موجودة لنقطة نقر معيّنة، لتحديدها (حذف/نقل)
function hitTestOpenings(rooms, cx, cy) {
  let best = null;
  rooms.forEach((r) => {
    (r.openings || []).forEach((o) => {
      const width = o.kind === "door" ? DOOR_W : WIN_W;
      const m = openingMarkPoints(r, o, width);
      const { dist } = pointSegDist(cx, cy, m.x1, m.y1, m.x2, m.y2);
      if (!best || dist < best.dist) best = { dist, roomId: r.id, id: o.id, wall: o.wall, edgeIndex: o.edge_index, position: o.position, kind: o.kind };
    });
  });
  if (!best || best.dist > OPENING_HIT_TOLERANCE) return null;
  return best;
}

// بيرجع نقطتين لرسم علامة فتحة (بمساحة المخطط 2D بالمتر) — على جدار مستطيل مسمّى (wall)
// أو على ضلع شكل حر (edge_index، القيمتين بالكائن opening، نفس شكل صف قاعدة البيانات)
function openingMarkPoints(room, opening, width) {
  const half = width / 2;
  if (room.points) {
    const i = opening.edgeIndex ?? opening.edge_index;
    const p1 = room.points[i], p2 = room.points[(i + 1) % room.points.length];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const t0 = (opening.position - half) / len, t1 = (opening.position + half) / len;
    return {
      x1: p1.x + (p2.x - p1.x) * t0, y1: p1.y + (p2.y - p1.y) * t0,
      x2: p1.x + (p2.x - p1.x) * t1, y2: p1.y + (p2.y - p1.y) * t1,
    };
  }
  const { wall, position } = opening;
  if (wall === "top" || wall === "bottom") {
    const y = wall === "top" ? room.gy : room.gy + room.gh;
    return { x1: room.gx + position - half, y1: y, x2: room.gx + position + half, y2: y };
  }
  const x = wall === "left" ? room.gx : room.gx + room.gw;
  return { x1: x, y1: room.gy + position - half, x2: x, y2: room.gy + position + half };
}

const DIM_OFFSET = 0.35; // بالمتر — بعد خط القياس عن حافة الغرفة
const DIM_EXT = 0.08; // بالمتر — مقدار تجاوز خط التمديد لخط القياس

// خطوط قياس بأسلوب المخططات الهندسية حوالين كل ضلع من غرفة مستطيلة — خط قياس بخطوط تمديد
// صغيرة بالطرفين ورقم الطول بالمنتصف (نفس فكرة القياسات على مخططات AutoCAD الاحترافية).
// الغرف الحرة (points) برّا نطاق الإصدار الأول — نفس قيود الأبواب/النوافذ/الأثاث عليها،
// ما إلها أطوال أضلاع فردية بسيطة زي المستطيل (بس مساحة إجمالية عبر roomArea)
function drawRoomDimensions(ctx, room, colors) {
  if (room.points) return;
  const { gx, gy, gw, gh } = room;
  ctx.save();
  ctx.strokeStyle = colors.line;
  ctx.fillStyle = colors.text;
  ctx.lineWidth = 1;
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";

  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1 * PPM, y1 * PPM);
    ctx.lineTo(x2 * PPM, y2 * PPM);
    ctx.stroke();
  };

  const topY = gy - DIM_OFFSET;
  line(gx, gy, gx, topY - DIM_EXT);
  line(gx + gw, gy, gx + gw, topY - DIM_EXT);
  line(gx, topY, gx + gw, topY);
  ctx.fillText(gw.toFixed(2), (gx + gw / 2) * PPM, (topY - 0.06) * PPM);

  const bottomY = gy + gh + DIM_OFFSET;
  line(gx, gy + gh, gx, bottomY + DIM_EXT);
  line(gx + gw, gy + gh, gx + gw, bottomY + DIM_EXT);
  line(gx, bottomY, gx + gw, bottomY);
  ctx.fillText(gw.toFixed(2), (gx + gw / 2) * PPM, (bottomY + 0.16) * PPM);

  const leftX = gx - DIM_OFFSET;
  line(gx, gy, leftX - DIM_EXT, gy);
  line(gx, gy + gh, leftX - DIM_EXT, gy + gh);
  line(leftX, gy, leftX, gy + gh);
  ctx.save();
  ctx.translate(leftX * PPM - 6, (gy + gh / 2) * PPM);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(gh.toFixed(2), 0, 0);
  ctx.restore();

  const rightX = gx + gw + DIM_OFFSET;
  line(gx + gw, gy, rightX + DIM_EXT, gy);
  line(gx + gw, gy + gh, rightX + DIM_EXT, gy + gh);
  line(rightX, gy, rightX, gy + gh);
  ctx.save();
  ctx.translate(rightX * PPM + 6, (gy + gh / 2) * PPM);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(gh.toFixed(2), 0, 0);
  ctx.restore();

  ctx.restore();
}

// مركز تقريبي للغرفة — bounding box للمستطيل، ومعدّل رؤوس الشكل الحر (كافي لتحديد "جهة
// الداخل" لقوس الباب، مش لازم يكون مركز المساحة الدقيق)
function roomCentroid(room) {
  if (room.points && room.points.length) {
    const n = room.points.length;
    return {
      x: room.points.reduce((s, p) => s + p.x, 0) / n,
      y: room.points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: room.gx + room.gw / 2, y: room.gy + room.gh / 2 };
}

// قوس اتجاه فتح الباب + خط الباب المفتوح (الشيش) — نفس الرمز المعياري بالمخططات الهندسية.
// اتجاه الفتح يُحسب ديناميكياً (بدل جدول ثابت لأربع جهات) عشان يشتغل على أي زاوية جدار —
// مايل بالغرف الحرة أو محاذي بالمستطيلة: عمودَي اتجاه الضلع (m.x2-m.x1)، وبنختار العمود
// يلي بيأشّر لمركز الغرفة (الباب بيفتح لداخلها دايماً — قرار الإصدار الأول، بلا عمود
// بقاعدة البيانات لاختيار الاتجاه). المفصلة (hinge) دايماً بالطرف الأول لعلامة الفتحة
function drawDoorSwing(ctx, room, opening, color) {
  if (opening.kind !== "door") return;
  const m = openingMarkPoints(room, opening, DOOR_W);
  const dx = m.x2 - m.x1, dy = m.y2 - m.y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;

  const n1 = { x: -dy / len, y: dx / len }, n2 = { x: dy / len, y: -dx / len };
  const c = roomCentroid(room);
  const midX = (m.x1 + m.x2) / 2, midY = (m.y1 + m.y2) / 2;
  const toCenter = { x: c.x - midX, y: c.y - midY };
  const n = (n1.x * toCenter.x + n1.y * toCenter.y) >= 0 ? n1 : n2;

  const closedAngle = Math.atan2(dy, dx);
  const openAngle = Math.atan2(n.y, n.x);
  let diff = openAngle - closedAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  const ccw = diff < 0;

  const cx = m.x1, cy = m.y1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(cx * PPM, cy * PPM, DOOR_W * PPM, closedAngle, openAngle, ccw);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(cx * PPM, cy * PPM);
  ctx.lineTo((cx + DOOR_W * Math.cos(openAngle)) * PPM, (cy + DOOR_W * Math.sin(openAngle)) * PPM);
  ctx.stroke();
  ctx.restore();
}

// خطوط الدرجات — الرمز المعياري لسلم بمخطط هندسي (بدل مستطيل فاضي بكتابة "سلم" بس).
// sx/sy بالبكسل (زاوية مربط الإحاطة)، w/sd بالمتر (بعد التبديل حسب الدوران — نفس مخرجات
// stairEffectiveFootprint). عدد الخطوط محدود بـ 16 حتى لو numSteps الفعلي أكبر، تجنّب
// ازدحام بصري بسلالم طوابق عالية الارتفاع
function drawStairSymbol(ctx, sx, sy, w, sd, rotation, numSteps, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const steps = clamp(numSteps, 2, 16);
  const swapped = rotation === 90 || rotation === 270;
  for (let i = 1; i < steps; i++) {
    ctx.beginPath();
    if (!swapped) {
      const ty = sy + (sd * PPM * i) / steps;
      ctx.moveTo(sx, ty);
      ctx.lineTo(sx + w * PPM, ty);
    } else {
      const tx = sx + (w * PPM * i) / steps;
      ctx.moveTo(tx, sy);
      ctx.lineTo(tx, sy + sd * PPM);
    }
    ctx.stroke();
  }
  ctx.restore();
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
// اختبار نقطة-داخل-مضلع (ray casting قياسي) — لازم لاحتواء الأثاث بغرفة حرة الشكل بدل
// احتواء مستطيل بسيط. points بإحداثيات مطلقة بالمتر (نفس نظام room.points)
function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function hitTestRoomForFurniture(rooms, cx, cy, kind, excludeId) {
  const room = rooms.find((r) => (r.points ? pointInPolygon(r.points, cx, cy) : cx >= r.gx && cx <= r.gx + r.gw && cy >= r.gy && cy <= r.gy + r.gh));
  if (!room) return null;
  const { w, d } = furnitureFootprint(kind, 0);

  let x, y;
  if (room.points) {
    // بلا حصر جوّا حدود الغرفة (نفس الحصر البسيط للمستطيل) — تحديد شكل مضلع حر دقيق أصعب
    // بكتير (بيحتاج inset هندسي)؛ قرار الإصدار الأول: المركز لازم يكون جوّا الشكل بس، مو
    // القطعة كاملها، فقطعة قريبة من جدار مايل ممكن تلامسه بصرياً — قيد موثّق
    x = cx - room.gx;
    y = cy - room.gy;
  } else {
    if (room.gw < w || room.gh < d) return null;
    const half_w = w / 2, half_d = d / 2;
    x = clamp(cx - room.gx, half_w, room.gw - half_w);
    y = clamp(cy - room.gy, half_d, room.gh - half_d);
  }

  const half_w = w / 2, half_d = d / 2;
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
    ctx.strokeStyle = x % 5 === 0 ? "#C7C7CC" : "#EDEDF0";
    ctx.lineWidth = x % 5 === 0 ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(x * PPM + 0.5, 0);
    ctx.lineTo(x * PPM + 0.5, gridH * PPM);
    ctx.stroke();
  }
  for (let y = 0; y <= gridH; y++) {
    ctx.strokeStyle = y % 5 === 0 ? "#C7C7CC" : "#EDEDF0";
    ctx.lineWidth = y % 5 === 0 ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y * PPM + 0.5);
    ctx.lineTo(gridW * PPM, y * PPM + 0.5);
    ctx.stroke();
  }

  floorRoomsList.forEach((r) => {
    const x = r.gx * PPM, y = r.gy * PPM, rw = r.gw * PPM, rh = r.gh * PPM;

    if (r.points && r.points.length >= 3) {
      ctx.beginPath();
      r.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x * PPM, p.y * PPM);
        else ctx.lineTo(p.x * PPM, p.y * PPM);
      });
      ctx.closePath();
      ctx.fillStyle = r.color + "25";
      ctx.fill();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#1A1A1D";
      ctx.font = "700 13px Tajawal, sans-serif";
      ctx.fillText(r.name, x + 8, y + 20);
      ctx.fillStyle = "#68686E";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${roomArea(r).toFixed(1)} m²`, x + 8, y + 36);
    } else {
      ctx.fillStyle = r.color + "25";
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, rw, rh);
      ctx.fillStyle = "#1A1A1D";
      ctx.font = "700 13px Tajawal, sans-serif";
      ctx.fillText(r.name, x + 8, y + 20);
      ctx.fillStyle = "#68686E";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${r.gw.toFixed(1)} × ${r.gh.toFixed(1)} m`, x + 8, y + 36);
      drawRoomDimensions(ctx, r, { line: "#B45309", text: "#92400E" });
    }

    (r.openings || []).forEach((o) => {
      const width = o.kind === "door" ? DOOR_W : WIN_W;
      const m = openingMarkPoints(r, o, width);
      ctx.strokeStyle = o.kind === "door" ? "#8B5A2B" : "#0EA5E9";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(m.x1 * PPM, m.y1 * PPM);
      ctx.lineTo(m.x2 * PPM, m.y2 * PPM);
      ctx.stroke();
      drawDoorSwing(ctx, r, o, "#8B5A2B");
    });

    (r.furniture || []).forEach((f) => {
      const { w, d: fd } = furnitureFootprint(f.kind, f.rotation || 0);
      const fx = (r.gx + f.x - w / 2) * PPM, fy = (r.gy + f.y - fd / 2) * PPM;
      ctx.fillStyle = "#A9895C25";
      ctx.fillRect(fx, fy, w * PPM, fd * PPM);
      ctx.strokeStyle = "#A9895C";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fy, w * PPM, fd * PPM);
      ctx.fillStyle = "#1A1A1D";
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

// شريط الأدوات العائم (نقل/تدوير/حذف) بيظهر عادةً فوق العنصر المحدد — لو العنصر قريب من
// الحافة العليا للشبكة، الشريط بيصير خارج المنطقة المرئية (main عندها overflow-auto، ما
// بتقدر تتمرر لمساحة سالبة) فيضل مخفي عن المستخدم بلا أي طريقة يوصله. الحل: نقلب الشريط
// تحت العنصر بدل فوقه لو المساحة فوقه أقل من ارتفاعه التقريبي (بالبكسل)
const TOOLBAR_H_PX = 56;
function toolbarPlacement(topAnchorM, bottomAnchorM, gridH) {
  const flip = topAnchorM * PPM < TOOLBAR_H_PX;
  const anchorM = flip ? bottomAnchorM : topAnchorM;
  return { pct: clamp((anchorM / gridH) * 100, 2, 98), flip };
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

function PhaseTracker({ phases, setPhases, designProgress, onOpenDesign, notifyError }) {
  const [expandedId, setExpandedId] = useState(null);

  async function cycleStatus(phase) {
    const next = phase.status === "not_started" ? "in_progress" : phase.status === "in_progress" ? "done" : "not_started";
    setPhases((prev) => prev.map((p) => (p.id === phase.id ? { ...p, status: next } : p)));
    const { error } = await supabase.from("phases").update({ status: next }).eq("id", phase.id);
    if (error) notifyError("تحديث حالة المرحلة", error);
  }

  async function fieldCommit(phaseId, field, value) {
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, [field]: value } : p)));
    const payload = { [field]: value === "" && (field === "start_date" || field === "end_date") ? null : value };
    const { error } = await supabase.from("phases").update(payload).eq("id", phaseId);
    if (error) notifyError("تحديث بيانات المرحلة", error);
  }

  async function toggleSubtask(subtaskId, done) {
    setPhases((prev) => prev.map((p) => ({
      ...p,
      subtasks: p.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
    })));
    const { error } = await supabase.from("subtasks").update({ done }).eq("id", subtaskId);
    if (error) notifyError("تحديث المهمة الفرعية", error);
  }

  async function addSubtask(phaseId, text, sortOrder) {
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ phase_id: phaseId, text, sort_order: sortOrder })
      .select()
      .single();
    if (error) { notifyError("إضافة المهمة الفرعية", error); return; }
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, subtasks: [...p.subtasks, data] } : p)));
  }

  async function removeSubtask(subtaskId) {
    setPhases((prev) => prev.map((p) => ({ ...p, subtasks: p.subtasks.filter((s) => s.id !== subtaskId) })));
    const { error } = await supabase.from("subtasks").delete().eq("id", subtaskId);
    if (error) notifyError("حذف المهمة الفرعية", error);
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

// لوحة قياسات دقيقة لغرفة مستطيلة محددة — 4 حقول رقمية تكتب مباشرة على gx/gy/gw/gh
// (بدل السحب بس)؛ حالة محلية بتنعكس من الغرفة عند تغيّر id/قيمها (نفس نمط owner/notes
// بـ PhaseCard)، والكتابة الفعلية لقاعدة البيانات تصير عند الخروج من الحقل (onBlur)
function PreciseMeasurePanel({ room, onCommit }) {
  const [local, setLocal] = useState({ gx: room.gx, gy: room.gy, gw: room.gw, gh: room.gh });

  useEffect(() => {
    setLocal({ gx: room.gx, gy: room.gy, gw: room.gw, gh: room.gh });
  }, [room.id, room.gx, room.gy, room.gw, room.gh]);

  function field(label, key, min) {
    return (
      <div>
        <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
        <input
          type="number"
          step="0.05"
          min={min}
          value={local[key]}
          onChange={(e) => setLocal((l) => ({ ...l, [key]: e.target.value }))}
          onBlur={(e) => {
            const v = Math.max(min, parseFloat(e.target.value) || min);
            setLocal((l) => ({ ...l, [key]: v }));
            if (v !== room[key]) onCommit(key, v);
          }}
          className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono"
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Ruler size={13} /> قياسات دقيقة</p>
      <div className="grid grid-cols-2 gap-2">
        {field("X", "gx", 0)}
        {field("Y", "gy", 0)}
        {field("العرض", "gw", 0.3)}
        {field("العمق", "gh", 0.3)}
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
    const sample = [
      { project_id: project.id, name: "صالة", gx: 1, gy: 1, gw: 6, gh: 5, color: ROOM_COLORS[0].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "مطبخ", gx: 7.5, gy: 1, gw: 4, gh: 5, color: ROOM_COLORS[1].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "غرفة نوم", gx: 1, gy: 6.5, gw: 5, gh: 4, color: ROOM_COLORS[2].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
      { project_id: project.id, name: "حمام", gx: 6.5, gy: 6.5, gw: 3, gh: 4, color: ROOM_COLORS[3].hex, floor: currentFloor, has_roof: false, wall_height: inheritedHeight, wall_color: inheritedColor },
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
              <Viewport3D rooms={rooms} stairs={stairsList} wallHeight={wallHeight} wallColor={wallColor} autoRotate={autoRotate} />
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
