// تصدير DXF (تنسيق تبادل الرسومات — بديل مفتوح ومتوافق فعلياً مع AutoCAD بدل DWG الثنائي
// المُغلق يلي بيحتاج SDK مُرخّص من Autodesk مش ممكن تضمينه هون؛ AutoCAD وكل برامج الـ CAD
// تقريباً بتفتح DXF مباشرة بلا أي تحويل). يبني ملف نصي ASCII/UTF-8 وفق مواصفة DXF القياسية،
// بمستوى AC1021 (AutoCAD 2007+) يدعم يونيكود (نصوص عربية) مباشرة بلا حاجة لترميز \U+ خاص.
//
// كل الهندسة تُحسب أولاً بالفراغ الأصلي للتطبيق (Y للأسفل، نفس نظام drawPlan)، بإعادة استخدام
// الدوال الجاهزة والمُختبرة من lib/planGeometry.js (openingMarkPoints, roomCentroid) بلا أي
// تعديل عليها — أضمن من "خداع" الدوال بغرفة معكوسة. الانعكاس لفراغ DXF (Y للأعلى، التقليد
// القياسي بملفات CAD) بيصير بخطوة أخيرة صريحة (flip) على كل نقطة قبل كتابتها، وبعدين أي حساب
// إضافي (زوايا فتح الباب، مضلعات الجدران) بيصير بفراغ DXF المُسطّح مباشرة — نفس المعادلات
// بالضبط، بس بلا أي حاجة للقلق بخصوص كيف الانعكاس بيأثر على الزوايا حسابياً
import { DOOR_W, WIN_W, WALL_T, roomArea } from "./build3d";
import { openingMarkPoints, roomCentroid, DIM_OFFSET, DIM_EXT, stairEffectiveFootprint, floorToFloorHeight } from "./planGeometry";

const LAYERS = {
  WALLS: 7,
  DOORS: 1,
  WINDOWS: 5,
  DIMENSIONS: 3,
  TEXT: 7,
  STAIRS: 8,
};

function deg(rad) {
  let d = (rad * 180) / Math.PI;
  d = d % 360;
  if (d < 0) d += 360;
  return d;
}

function flip(p, xOffset) {
  return { x: p.x + xOffset, y: -p.y };
}

function dxfLine(entities, layer, p1, p2) {
  entities.push(`0\nLINE\n8\n${layer}\n10\n${p1.x}\n20\n${p1.y}\n30\n0.0\n11\n${p2.x}\n21\n${p2.y}\n31\n0.0`);
}

function dxfLwPolyline(entities, layer, points, closed) {
  const lines = ["0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", closed ? "1" : "0"];
  points.forEach((p) => { lines.push("10", String(p.x), "20", String(p.y)); });
  entities.push(lines.join("\n"));
}

function dxfArc(entities, layer, cx, cy, radius, startDeg, endDeg) {
  entities.push(`0\nARC\n8\n${layer}\n10\n${cx}\n20\n${cy}\n30\n0.0\n40\n${radius}\n50\n${startDeg}\n51\n${endDeg}`);
}

function dxfText(entities, layer, p, height, text, rotationDeg = 0) {
  const safe = String(text).replace(/[\r\n]+/g, " ");
  entities.push(`0\nTEXT\n8\n${layer}\n10\n${p.x}\n20\n${p.y}\n30\n0.0\n40\n${height}\n1\n${safe}\n50\n${rotationDeg}`);
}

// نفس خوارزمية "المشي بالمؤشر" المستخدمة بـ buildWall/buildAngledWallSegment (lib/build3d.js)
// لحساب أعمدة الجدار الصلبة حوالين الفتحات — نسخة مستقلة صغيرة هون (مو استيراد من build3d.js
// لتفادي سحب كل منطق Three.js)، بس نفس المنطق بالضبط
function wallPillars(openings, length) {
  const sorted = openings.slice().sort((a, b) => a.position - b.position);
  let cursor = 0;
  const pillars = [];
  sorted.forEach((o) => {
    const start = o.position - o.width / 2;
    const end = o.position + o.width / 2;
    if (start > cursor + 0.02) pillars.push([cursor, start]);
    cursor = Math.max(cursor, end);
  });
  if (cursor < length - 0.02) pillars.push([cursor, length]);
  return pillars;
}

// جدار مزدوج الخط (سماكة WALL_T حوالين خط منتصف الضلع) مقسّم لأعمدة صلبة حوالين الفتحات —
// نفس تمثيل الجدران المعياري بمخططات CAD المعمارية (بعكس خط واحد بسيط بيعبر فوق الأبواب)
function drawWallEdge(entities, p1, p2, openings, xOffset) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.02) return;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const half = WALL_T / 2;
  wallPillars(openings, length).forEach(([a, b]) => {
    const corners = [
      { x: p1.x + ux * a - nx * half, y: p1.y + uy * a - ny * half },
      { x: p1.x + ux * b - nx * half, y: p1.y + uy * b - ny * half },
      { x: p1.x + ux * b + nx * half, y: p1.y + uy * b + ny * half },
      { x: p1.x + ux * a + nx * half, y: p1.y + uy * a + ny * half },
    ].map((p) => flip(p, xOffset));
    dxfLwPolyline(entities, "WALLS", corners, true);
  });
}

function rectWallEdges(room) {
  const { gx, gy, gw, gh } = room;
  return [
    { wall: "top", p1: { x: gx, y: gy }, p2: { x: gx + gw, y: gy } },
    { wall: "bottom", p1: { x: gx, y: gy + gh }, p2: { x: gx + gw, y: gy + gh } },
    { wall: "left", p1: { x: gx, y: gy }, p2: { x: gx, y: gy + gh } },
    { wall: "right", p1: { x: gx + gw, y: gy }, p2: { x: gx + gw, y: gy + gh } },
  ];
}

// قوس اتجاه فتح الباب — نفس معادلات drawDoorSwing (planGeometry.js) بالضبط، بس على نقاط
// مُسطّحة أصلاً لفراغ DXF (Y للأعلى) بدل نقاط الكانفاس (Y للأسفل)؛ نتيجة إعادة تطبيق نفس
// الخوارزمية على فراغ مختلف — أضمن رياضياً من محاولة "تحويل" زاوية محسوبة بفراغ تاني
function drawDoorSwingDxf(entities, room, opening, xOffset) {
  const m = openingMarkPoints(room, opening, DOOR_W);
  const centroid = roomCentroid(room);
  const p1 = flip({ x: m.x1, y: m.y1 }, xOffset);
  const p2 = flip({ x: m.x2, y: m.y2 }, xOffset);
  const c = flip(centroid, xOffset);

  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;

  const n1 = { x: -dy / len, y: dx / len }, n2 = { x: dy / len, y: -dx / len };
  const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
  const toCenter = { x: c.x - midX, y: c.y - midY };
  const n = (n1.x * toCenter.x + n1.y * toCenter.y) >= 0 ? n1 : n2;

  const closedAngle = Math.atan2(dy, dx);
  const openAngle = Math.atan2(n.y, n.x);
  let diff = openAngle - closedAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  const ccw = diff < 0; // نفس اصطلاح canvas ctx.arc: ccw=true يعني المسح باتجاه الزاوية المتناقصة

  // DXF ARC بيمسح دايماً باتجاه الزاوية المتزايدة (عكس عقارب الساعة) من البداية للنهاية —
  // لو ccw (مسح متناقص بمصطلح canvas) لازم نعكس ترتيب البداية/النهاية لنغطي نفس القوس فعلياً
  const startAngle = ccw ? openAngle : closedAngle;
  const endAngle = ccw ? closedAngle : openAngle;
  dxfArc(entities, "DOORS", p1.x, p1.y, len, deg(startAngle), deg(endAngle));

  const leafEnd = { x: p1.x + len * Math.cos(openAngle), y: p1.y + len * Math.sin(openAngle) };
  dxfLine(entities, "DOORS", p1, leafEnd);
}

function drawWindowMarkDxf(entities, room, opening, xOffset) {
  const m = openingMarkPoints(room, opening, WIN_W);
  dxfLine(entities, "WINDOWS", flip({ x: m.x1, y: m.y1 }, xOffset), flip({ x: m.x2, y: m.y2 }, xOffset));
}

// خطوط قياس بأسلوب CAD حوالين كل ضلع — نفس هندسة drawRoomDimensions (planGeometry.js) بس
// بالمتر مباشرة (بلا PPM، مو رسم كانفاس)، ثم انعكاس كل نقطة لفراغ DXF
function drawRoomDimensionsDxf(entities, room, xOffset) {
  const { gx, gy, gw, gh } = room;
  const P = (x, y) => flip({ x, y }, xOffset);
  const line = (x1, y1, x2, y2) => dxfLine(entities, "DIMENSIONS", P(x1, y1), P(x2, y2));

  const topY = gy - DIM_OFFSET;
  line(gx, gy, gx, topY - DIM_EXT);
  line(gx + gw, gy, gx + gw, topY - DIM_EXT);
  line(gx, topY, gx + gw, topY);
  dxfText(entities, "DIMENSIONS", P(gx + gw / 2, topY - 0.1), 0.14, gw.toFixed(2));

  const bottomY = gy + gh + DIM_OFFSET;
  line(gx, gy + gh, gx, bottomY + DIM_EXT);
  line(gx + gw, gy + gh, gx + gw, bottomY + DIM_EXT);
  line(gx, bottomY, gx + gw, bottomY);
  dxfText(entities, "DIMENSIONS", P(gx + gw / 2, bottomY + 0.15), 0.14, gw.toFixed(2));

  const leftX = gx - DIM_OFFSET;
  line(gx, gy, leftX - DIM_EXT, gy);
  line(gx, gy + gh, leftX - DIM_EXT, gy + gh);
  line(leftX, gy, leftX, gy + gh);
  dxfText(entities, "DIMENSIONS", P(leftX - 0.1, gy + gh / 2), 0.14, gh.toFixed(2), 90);

  const rightX = gx + gw + DIM_OFFSET;
  line(gx + gw, gy, rightX + DIM_EXT, gy);
  line(gx + gw, gy + gh, rightX + DIM_EXT, gy + gh);
  line(rightX, gy, rightX, gy + gh);
  dxfText(entities, "DIMENSIONS", P(rightX + 0.15, gy + gh / 2), 0.14, gh.toFixed(2), 90);
}

function drawRoomLabelDxf(entities, room, xOffset) {
  const anchor = room.points ? { x: Math.min(...room.points.map((p) => p.x)), y: Math.min(...room.points.map((p) => p.y)) } : { x: room.gx, y: room.gy };
  dxfText(entities, "TEXT", flip({ x: anchor.x + 0.25, y: anchor.y + 0.5 }, xOffset), 0.22, room.name);
  dxfText(entities, "TEXT", flip({ x: anchor.x + 0.25, y: anchor.y + 0.85 }, xOffset), 0.14, `${roomArea(room).toFixed(1)} m2`);
}

function drawStairsDxf(entities, allRooms, stairsForFloor, projectWallHeight, xOffset) {
  stairsForFloor.forEach((s) => {
    const h = floorToFloorHeight(allRooms, s.floor ?? 0, projectWallHeight);
    const rotation = s.rotation || 0;
    const { w, d } = stairEffectiveFootprint(h, rotation);
    const x0 = s.x - w / 2, x1 = s.x + w / 2, y0 = s.y - d / 2, y1 = s.y + d / 2;
    const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map((p) => flip(p, xOffset));
    dxfLwPolyline(entities, "STAIRS", corners, true);

    const swapped = rotation === 90 || rotation === 270;
    const steps = 10; // تقريب بعدد ثابت معقول للدرجات — تفاصيل حساب numSteps الدقيق مو مهمة بمخطط CAD
    for (let i = 1; i < steps; i++) {
      if (!swapped) {
        const ty = y0 + (d * i) / steps;
        dxfLine(entities, "STAIRS", flip({ x: x0, y: ty }, xOffset), flip({ x: x1, y: ty }, xOffset));
      } else {
        const tx = x0 + (w * i) / steps;
        dxfLine(entities, "STAIRS", flip({ x: tx, y: y0 }, xOffset), flip({ x: tx, y: y1 }, xOffset));
      }
    }
  });
}

function buildFloorEntities(allRooms, floorRoomsList, stairsForFloor, wallHeight, xOffset, label, showDimensions) {
  const entities = [];
  dxfText(entities, "TEXT", flip({ x: 0, y: -0.7 }, xOffset), 0.35, label);

  floorRoomsList.forEach((room) => {
    if (room.points && room.points.length >= 3) {
      const n = room.points.length;
      for (let i = 0; i < n; i++) {
        const p1 = room.points[i], p2 = room.points[(i + 1) % n];
        const opens = (room.openings || [])
          .filter((o) => o.edge_index === i)
          .map((o) => ({ position: o.position, width: o.kind === "door" ? DOOR_W : WIN_W }));
        drawWallEdge(entities, p1, p2, opens, xOffset);
      }
    } else {
      rectWallEdges(room).forEach(({ wall, p1, p2 }) => {
        const opens = (room.openings || [])
          .filter((o) => o.wall === wall)
          .map((o) => ({ position: o.position, width: o.kind === "door" ? DOOR_W : WIN_W }));
        drawWallEdge(entities, p1, p2, opens, xOffset);
      });
      if (showDimensions) drawRoomDimensionsDxf(entities, room, xOffset);
    }

    (room.openings || []).forEach((o) => {
      if (o.kind === "door") drawDoorSwingDxf(entities, room, o, xOffset);
      else drawWindowMarkDxf(entities, room, o, xOffset);
    });

    drawRoomLabelDxf(entities, room, xOffset);
  });

  drawStairsDxf(entities, allRooms, stairsForFloor, wallHeight, xOffset);
  return entities;
}

// floorsMeta: [{floorNum, label, rooms}] — نفس شكل مصفوفة floors بدالة handlePrint بالضبط
export function exportFloorsToDxf(allRooms, floorsMeta, stairsList, wallHeight, showDimensions = true) {
  const layerDefs = Object.entries(LAYERS)
    .map(([name, color]) => `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS`)
    .join("\n");

  const allEntities = [];
  let xOffset = 0;
  const GUTTER = 3;
  floorsMeta.forEach((f) => {
    const stairsForFloor = stairsList.filter((s) => (s.floor ?? 0) === f.floorNum);
    allEntities.push(...buildFloorEntities(allRooms, f.rooms, stairsForFloor, wallHeight, xOffset, f.label, showDimensions));
    const maxX = f.rooms.length
      ? Math.max(...f.rooms.map((r) => (r.points ? Math.max(...r.points.map((p) => p.x)) : r.gx + r.gw)))
      : 10;
    xOffset += maxX + GUTTER;
  });

  const header = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1021", "9", "$INSUNITS", "70", "6", "0", "ENDSEC"].join("\n");
  const tables = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(Object.keys(LAYERS).length), layerDefs, "0", "ENDTAB", "0", "ENDSEC"].join("\n");
  const entitiesSection = ["0", "SECTION", "2", "ENTITIES", ...allEntities, "0", "ENDSEC"].join("\n");

  return [header, tables, entitiesSection, "0", "EOF"].join("\n") + "\n";
}
