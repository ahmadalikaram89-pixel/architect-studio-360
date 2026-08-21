// دوال هندسية/رسم/التقاط خاصة بالمخطط 2D — بلا React، بمدخلات/مخرجات صريحة بالكامل (بلا حالة
// مشتركة)، تُستخدم من المكوّن الرئيسي (رسم المخطط الحي والتفاعل) ومن رسم نسخة الطباعة/PDF.
import { DOOR_W, WIN_W, FURNITURE_KINDS, computeFloorBaseYMap, stairFootprint, roomArea } from "./build3d";

export const PPM = 32;

export function snap(v, step = 0.5) {
  return Math.round(v / step) * step;
}
export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

export const FLOOR_ORDINALS = [
  "الطابق الأرضي", "الطابق الأول", "الطابق الثاني", "الطابق الثالث", "الطابق الرابع",
  "الطابق الخامس", "الطابق السادس", "الطابق السابع", "الطابق الثامن", "الطابق التاسع",
  "الطابق العاشر", "الطابق الحادي عشر", "الطابق الثاني عشر",
];
export function floorLabel(n) {
  return FLOOR_ORDINALS[n] || `الطابق ${n}`;
}
export const FLOOR_CAP = 12;

export const WALL_SNAP_TOLERANCE = 0.3; // بالمتر — كافي لالتقاط جدار بسماكة 0.15م بدون ما يلتقط جدار غرفة تانية غلط
export const OPENING_HIT_TOLERANCE = 0.22; // بالمتر — لالتقاط النقر على علامة باب/نافذة موجودة لتحديدها

export function pointSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// بيلاقي أقرب جدار (لأي غرفة) لنقطة ضغط/تمرير معيّنة، ضمن مسافة التقاط معقولة،
// وبيتأكد إنه في مجال كافي للفتحة الجديدة بلا تداخل مع فتحة موجودة أصلاً
export function hitTestWalls(rooms, cx, cy, openingWidth, kind, sharedRanges, excludeOpeningId) {
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
export function hitTestOpenings(rooms, cx, cy) {
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
export function openingMarkPoints(room, opening, width) {
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

export const DIM_OFFSET = 0.35; // بالمتر — بعد خط القياس عن حافة الغرفة
export const DIM_EXT = 0.08; // بالمتر — مقدار تجاوز خط التمديد لخط القياس

// خطوط قياس بأسلوب المخططات الهندسية حوالين كل ضلع من غرفة مستطيلة — خط قياس بخطوط تمديد
// صغيرة بالطرفين ورقم الطول بالمنتصف (نفس فكرة القياسات على مخططات AutoCAD الاحترافية).
// الغرف الحرة (points) برّا نطاق الإصدار الأول — نفس قيود الأبواب/النوافذ/الأثاث عليها،
// ما إلها أطوال أضلاع فردية بسيطة زي المستطيل (بس مساحة إجمالية عبر roomArea)
export function drawRoomDimensions(ctx, room, colors) {
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
export function roomCentroid(room) {
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
export function drawDoorSwing(ctx, room, opening, color) {
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
export function drawStairSymbol(ctx, sx, sy, w, sd, rotation, numSteps, color) {
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

export const FURNITURE_HIT_TOLERANCE = 0.12; // بالمتر — تسامح صغير للنقر قريب من حواف قطعة الأثاث

// بعد فعّال (عرض/عمق) لقطعة أثاث حسب دورانها — 90/270 بتبادل العرض والعمق (بلا حاجة لمثلثات
// بما إنه الدوران دايماً مضاعف 90°)
export function furnitureFootprint(kind, rotation) {
  const k = FURNITURE_KINDS[kind];
  if (!k) return { w: 0.5, d: 0.5 };
  const swapped = rotation === 90 || rotation === 270;
  return { w: swapped ? k.d : k.w, d: swapped ? k.w : k.d };
}

// بيلاقي أقرب قطعة أثاث موجودة لنقطة نقر معيّنة، لتحديدها (نقل/تدوير/حذف)
export function hitTestFurniture(rooms, cx, cy) {
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

// اختبار نقطة-داخل-مضلع (ray casting قياسي) — لازم لاحتواء الأثاث بغرفة حرة الشكل بدل
// احتواء مستطيل بسيط. points بإحداثيات مطلقة بالمتر (نفس نظام room.points)
export function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// بيلاقي الغرفة يلي جوّاها نقطة معيّنة (احتواء صارم، مش أقرب غرفة) لوضع قطعة أثاث فيها،
// بيحصر موضعها جوّا حدود الغرفة، ويرفض لو بتتراكب مع قطعة موجودة أصلاً (باستثناء excludeId
// أثناء النقل) أو لو القطعة أكبر من الغرفة
export function hitTestRoomForFurniture(rooms, cx, cy, kind, excludeId) {
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

export const STAIR_HIT_TOLERANCE = 0.15; // بالمتر — تسامح النقر على علامة سلم موجودة

// فرق ارتفاع القاعدة (Y) بين طابق وياللي فوقه مباشرة — نفس منطق computeFloorBaseYMap
// المستخدم بالبناء ثلاثي الأبعاد، مطلوب هون لحساب طول مسار السلم بالمخطط 2D
export function floorToFloorHeight(rooms, floor, projectWallHeight) {
  const map = computeFloorBaseYMap(rooms, projectWallHeight, floor + 1);
  return map.get(floor + 1) - map.get(floor);
}

// بعد فعّال (عرض/طول) لمساحة سلم حسب دورانه — نفس منطق furnitureFootprint بالضبط
export function stairEffectiveFootprint(floorToFloorH, rotation) {
  const { w, d } = stairFootprint(floorToFloorH);
  const swapped = rotation === 90 || rotation === 270;
  return { w: swapped ? d : w, d: swapped ? w : d };
}

// بيلاقي أقرب سلم موجود (بنفس الطابق) لنقطة نقر معيّنة، لتحديده (نقل/تدوير/حذف)
export function hitTestStairs(stairsForFloor, rooms, projectWallHeight, cx, cy) {
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
export function hitTestGridForStair(gridW, gridH, cx, cy, floorToFloorH, rotation) {
  const { w, d } = stairEffectiveFootprint(floorToFloorH, rotation);
  if (gridW < w || gridH < d) return null;
  const half_w = w / 2, half_d = d / 2;
  const x = clamp(cx, half_w, gridW - half_w);
  const y = clamp(cy, half_d, gridH - half_d);
  return { x, y };
}

// نسخة فاتحة (أبيض/رمادي) من رسم المخطط، مناسبة للطباعة/PDF بدل الثيم الغامق للتطبيق
export function drawFloorPlanImage(floorRoomsList, gridW, gridH) {
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

// شريط الأدوات العائم (نقل/تدوير/حذف) بيظهر عادةً فوق العنصر المحدد — لو العنصر قريب من
// الحافة العليا للشبكة، الشريط بيصير خارج المنطقة المرئية (main عندها overflow-auto، ما
// بتقدر تتمرر لمساحة سالبة) فيضل مخفي عن المستخدم بلا أي طريقة يوصله. الحل: نقلب الشريط
// تحت العنصر بدل فوقه لو المساحة فوقه أقل من ارتفاعه التقريبي (بالبكسل)
export const TOOLBAR_H_PX = 56;
export function toolbarPlacement(topAnchorM, bottomAnchorM, gridH) {
  const flip = topAnchorM * PPM < TOOLBAR_H_PX;
  const anchorM = flip ? bottomAnchorM : topAnchorM;
  return { pct: clamp((anchorM / gridH) * 100, 2, 98), flip };
}
