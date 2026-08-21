// تصدير IFC4 (Industry Foundation Classes) — تقدير أولي حقيقي لنموذج BIM ثلاثي الأبعاد،
// بديل مفتوح المصدر لتنسيقات BIM الاحتكارية (Revit .rvt وغيره). يبني ملف STEP نصي
// (ISO-10303-21) وفق مخطط IFC4 القياسي، بهرمية مكانية كاملة: IfcProject → IfcSite →
// IfcBuilding → IfcBuildingStorey لكل طابق، وعناصر إنشائية حقيقية (IfcWall/IfcSlab/
// IfcDoor/IfcWindow/IfcStair) بهندسة صلبة فعلية (IfcExtrudedAreaSolid) قابلة للفتح
// بأي برنامج BIM حقيقي (Revit, ArchiCAD, Solibri, FreeCAD, BIMcollab...).
//
// تحقّق الصيغة صار عبر مكتبة web-ifc (نفس محرّك التفسير يلي بيستخدمه IFC.js/That Open
// Company) بمثال يدوي بسيط قبل بناء المولّد الكامل — تأكيد إنه بنية STEP وهرمية
// IFCLOCALPLACEMENT وIFCEXTRUDEDAREASOLID المستخدمة هون صحيحة فعلاً وبتولّد هندسة حقيقية
// (Vertex/Index buffers)، مو بس نص "يشبه" IFC.
//
// **حدود واضحة للإصدار الأول** (موثّقة بقصد، مو نقص مخفي):
// - جدران كل غرفة تُبنى لحالها (نفس فلسفة تصدير DXF الموجود أصلاً) — بلا دمج جدار مشترك
//   بين غرفتين متلاصقتين، فممكن يصير تراكب هندسي بسيط بالجدار المشترك (clash) لو فتحته
//   ببرنامج تدقيق تصادم صارم
// - السقوف المائلة (جملوني/أربعة ميول) تُصدَّر كبلاطة مسطحة بمستوى ذروة الجدران (نفس
//   مساحة الغرفة) — مو الشكل المائل الفعلي؛ تمثيل الميل الحقيقي بـ IFC يحتاج هندسة
//   IfcShapeRepresentation أعقد بكتير (خارج نطاق الإصدار الأول)
// - الأبواب/النوافذ صناديق مبسّطة بمكان الفتحة (نفس أبعاد العرض/الارتفاع الحقيقية) —
//   بلا علاقة IfcRelVoidsElement/IfcOpeningElement الصورية الكاملة يلي برامج BIM
//   الاحترافية بتستخدمها لتمثيل "الفتحة" هندسياً؛ التمثيل هون فراغ فعلي بالجدار (نفس
//   منطق buildWall بالعرض ثلاثي الأبعاد) مع صندوق الباب/النافذة فوقه — نتيجة بصرية/حجمية
//   صحيحة، بس بلا العلاقة الدلالية الكاملة يلي بعض أدوات فحص BIM بتفحص عنها تحديداً
// - الأثاث غير مُصدَّر (نموذج BIM للمبنى نفسه، مو للمحتويات)
import { WALL_T, ROOF_T, computeFloorBaseYMap, openingRowToShape } from "./build3d";
import { floorLabel, floorToFloorHeight, stairEffectiveFootprint } from "./planGeometry";

const IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function randomIfcGuid() {
  let s = "";
  for (let i = 0; i < 22; i++) s += IFC_GUID_CHARS[Math.floor(Math.random() * IFC_GUID_CHARS.length)];
  return s;
}

function fmt(n) {
  if (!Number.isFinite(n)) n = 0;
  let s = n.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
  if (!s.includes(".")) s += ".0";
  return s;
}

function escapeStr(s) {
  return String(s ?? "").replace(/'/g, "''").replace(/[\r\n]+/g, " ");
}

class IfcWriter {
  constructor() {
    this.lines = [];
    this.next = 1;
  }
  add(text) {
    const id = this.next++;
    this.lines.push(`#${id}=${text};`);
    return id;
  }
}

function point2(w, x, y) {
  return w.add(`IFCCARTESIANPOINT((${fmt(x)},${fmt(y)}))`);
}
function point3(w, x, y, z) {
  return w.add(`IFCCARTESIANPOINT((${fmt(x)},${fmt(y)},${fmt(z)}))`);
}

// مضلع مغلق (بأي عدد أضلاع، مستطيل أو حر) مبثوق (extruded) رأسياً — الارتفاع بمحور Z (أعلى)،
// بدءاً من elevation. نقاط المضلع بإحداثيات العالم الحقيقية مباشرة (بلا حاجة لموضع محلي منفصل
// لكل عنصر — نفس فلسفة drawWallEdge بتصدير DXF: الموضع مبني بالهندسة نفسها مباشرة)
function extrudedSolid(w, points2d, height, elevation, zAxisId, xAxisId, extrudeDirId) {
  const ptIds = points2d.map((p) => point2(w, p.x, p.y));
  const polylineId = w.add(`IFCPOLYLINE((${[...ptIds, ptIds[0]].map((id) => `#${id}`).join(",")}))`);
  const profileId = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${polylineId})`);
  const basePt = point3(w, 0, 0, elevation);
  const axisId = w.add(`IFCAXIS2PLACEMENT3D(#${basePt},#${zAxisId},#${xAxisId})`);
  return w.add(`IFCEXTRUDEDAREASOLID(#${profileId},#${axisId},#${extrudeDirId},${fmt(height)})`);
}

function productShape(w, contextId, solidId) {
  const shapeRepId = w.add(`IFCSHAPEREPRESENTATION(#${contextId},'Body','SweptSolid',(#${solidId}))`);
  return w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}))`);
}

// IfcWall/IfcSlab/IfcStair: بنفس شكل الصفات (9: GlobalId..Tag + PredefinedType)
function addBuildingElement(w, kind, predefinedType, ownerHistory, name, placementId, shapeId) {
  return w.add(`${kind}('${randomIfcGuid()}',#${ownerHistory},'${escapeStr(name)}',$,$,#${placementId},#${shapeId},$,${predefinedType})`);
}

// IfcDoor/IfcWindow: صفات إضافية (OverallHeight/OverallWidth/PredefinedType + حقلين اختياريين)
function addFixtureElement(w, kind, predefinedType, ownerHistory, name, placementId, shapeId, height, width) {
  return w.add(`${kind}('${randomIfcGuid()}',#${ownerHistory},'${escapeStr(name)}',$,$,#${placementId},#${shapeId},$,${fmt(height)},${fmt(width)},${predefinedType},$,$)`);
}

// نفس خوارزمية "المشي بالمؤشر" المستخدمة بـ buildWall (lib/build3d.js) وwallPillars
// (lib/dxfExport.js) لحساب الأعمدة الصلبة حوالين الفتحات — نسخة محلية هون بالإصدار الكامل
// (start,width,sill,openH) عشان نبني الأعمدة + عتبات الفتحات فوق/تحت، مو بس الأعمدة
function wallSegments(resolvedOpenings, length) {
  const sorted = resolvedOpenings.slice().sort((a, b) => a.start - b.start);
  let cursor = 0;
  const pillars = [];
  sorted.forEach((o) => {
    if (o.start > cursor + 0.02) pillars.push([cursor, o.start]);
    cursor = Math.max(cursor, o.start + o.width);
  });
  if (cursor < length - 0.02) pillars.push([cursor, length]);
  return { pillars, openings: sorted };
}

function rectPoints(p1x, p1y, ux, uy, nx, ny, a, b, half) {
  return [
    { x: p1x + ux * a - nx * half, y: p1y + uy * a - ny * half },
    { x: p1x + ux * b - nx * half, y: p1y + uy * b - ny * half },
    { x: p1x + ux * b + nx * half, y: p1y + uy * b + ny * half },
    { x: p1x + ux * a + nx * half, y: p1y + uy * a + ny * half },
  ];
}

// جدار ضلع واحد (مستقيم) — أعمدة صلبة حوالين الفتحات + عتبات فوق/تحت كل فتحة + عنصر
// الباب/النافذة نفسه بمكانه (نفس بنية buildWall بالعرض ثلاثي الأبعاد بالضبط، بس عناصر IFC)
function addWallEdge(w, ctx, p1, p2, edgeOpenings, wallHeight, ownerHistory, placementId, elementIds) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.02) return;
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const half = WALL_T / 2;

  const resolved = edgeOpenings.map((o) => openingRowToShape(o, length, wallHeight));
  const { pillars, openings } = wallSegments(resolved, length);

  pillars.forEach(([a, b]) => {
    const corners = rectPoints(p1.x, p1.y, ux, uy, nx, ny, a, b, half);
    const solidId = extrudedSolid(w, corners, wallHeight, 0, ctx.zAxis, ctx.xAxis, ctx.zAxis);
    const shapeId = productShape(w, ctx.context, solidId);
    elementIds.push(addBuildingElement(w, "IFCWALL", ".SOLIDWALL.", ownerHistory, "Wall", placementId, shapeId));
  });

  openings.forEach((o) => {
    const corners = rectPoints(p1.x, p1.y, ux, uy, nx, ny, o.start, o.start + o.width, half);
    if (o.sill > 0.02) {
      const solidId = extrudedSolid(w, corners, o.sill, 0, ctx.zAxis, ctx.xAxis, ctx.zAxis);
      const shapeId = productShape(w, ctx.context, solidId);
      elementIds.push(addBuildingElement(w, "IFCWALL", ".SOLIDWALL.", ownerHistory, "Wall (تحت الفتحة)", placementId, shapeId));
    }
    const headerBottom = o.sill + o.openH;
    const headerH = wallHeight - headerBottom;
    if (headerH > 0.02) {
      const solidId = extrudedSolid(w, corners, headerH, headerBottom, ctx.zAxis, ctx.xAxis, ctx.zAxis);
      const shapeId = productShape(w, ctx.context, solidId);
      elementIds.push(addBuildingElement(w, "IFCWALL", ".SOLIDWALL.", ownerHistory, "Wall (فوق الفتحة)", placementId, shapeId));
    }
    const fixtureSolid = extrudedSolid(w, corners, o.openH, o.sill, ctx.zAxis, ctx.xAxis, ctx.zAxis);
    const fixtureShape = productShape(w, ctx.context, fixtureSolid);
    if (o.isDoor) {
      elementIds.push(addFixtureElement(w, "IFCDOOR", ".DOOR.", ownerHistory, "Door", placementId, fixtureShape, o.openH, o.width));
    } else {
      elementIds.push(addFixtureElement(w, "IFCWINDOW", ".WINDOW.", ownerHistory, "Window", placementId, fixtureShape, o.openH, o.width));
    }
  });
}

function rectRoomEdges(room) {
  const { gx, gy, gw, gh } = room;
  return [
    { wall: "top", p1: { x: gx, y: gy }, p2: { x: gx + gw, y: gy } },
    { wall: "bottom", p1: { x: gx, y: gy + gh }, p2: { x: gx + gw, y: gy + gh } },
    { wall: "left", p1: { x: gx, y: gy }, p2: { x: gx, y: gy + gh } },
    { wall: "right", p1: { x: gx + gw, y: gy }, p2: { x: gx + gw, y: gy + gh } },
  ];
}

function addRoomWallsAndSlabs(w, ctx, room, wallHeight, ownerHistory, placementId, elementIds) {
  if (room.points && room.points.length >= 3) {
    const n = room.points.length;
    for (let i = 0; i < n; i++) {
      const p1 = room.points[i], p2 = room.points[(i + 1) % n];
      const edgeOpenings = (room.openings || []).filter((o) => o.edge_index === i);
      addWallEdge(w, ctx, p1, p2, edgeOpenings, wallHeight, ownerHistory, placementId, elementIds);
    }
    const floorSolid = extrudedSolid(w, room.points, 0.06, -0.06, ctx.zAxis, ctx.xAxis, ctx.zAxis);
    elementIds.push(addBuildingElement(w, "IFCSLAB", ".FLOOR.", ownerHistory, "Floor", placementId, productShape(w, ctx.context, floorSolid)));
    if (room.has_roof) {
      const roofSolid = extrudedSolid(w, room.points, ROOF_T, wallHeight, ctx.zAxis, ctx.xAxis, ctx.zAxis);
      elementIds.push(addBuildingElement(w, "IFCSLAB", ".ROOF.", ownerHistory, "Roof", placementId, productShape(w, ctx.context, roofSolid)));
    }
    return;
  }

  rectRoomEdges(room).forEach(({ wall, p1, p2 }) => {
    const edgeOpenings = (room.openings || []).filter((o) => o.wall === wall);
    addWallEdge(w, ctx, p1, p2, edgeOpenings, wallHeight, ownerHistory, placementId, elementIds);
  });

  const rect = [
    { x: room.gx, y: room.gy },
    { x: room.gx + room.gw, y: room.gy },
    { x: room.gx + room.gw, y: room.gy + room.gh },
    { x: room.gx, y: room.gy + room.gh },
  ];
  const floorSolid = extrudedSolid(w, rect, 0.06, -0.06, ctx.zAxis, ctx.xAxis, ctx.zAxis);
  elementIds.push(addBuildingElement(w, "IFCSLAB", ".FLOOR.", ownerHistory, "Floor", placementId, productShape(w, ctx.context, floorSolid)));
  if (room.has_roof) {
    const roofSolid = extrudedSolid(w, rect, ROOF_T, wallHeight, ctx.zAxis, ctx.xAxis, ctx.zAxis);
    elementIds.push(addBuildingElement(w, "IFCSLAB", ".ROOF.", ownerHistory, "Roof", placementId, productShape(w, ctx.context, roofSolid)));
  }
}

function addStair(w, ctx, s, allRooms, projectWallHeight, ownerHistory, placementId, elementIds) {
  const h = floorToFloorHeight(allRooms, s.floor ?? 0, projectWallHeight);
  if (!(h > 0)) return;
  const rotation = s.rotation || 0;
  const { w: fw, d: fd } = stairEffectiveFootprint(h, rotation);
  const x0 = s.x - fw / 2, x1 = s.x + fw / 2, y0 = s.y - fd / 2, y1 = s.y + fd / 2;
  const rect = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const solidId = extrudedSolid(w, rect, h, 0, ctx.zAxis, ctx.xAxis, ctx.zAxis);
  const shapeId = productShape(w, ctx.context, solidId);
  elementIds.push(addBuildingElement(w, "IFCSTAIR", ".STRAIGHT_RUN_STAIR.", ownerHistory, "Stair", placementId, shapeId));
}

// project: صف المشروع (name, wall_height)؛ allRooms/stairsList: نفس بيانات المشروع
// المستخدمة بباقي أنواع التصدير (3D/DXF/BOQ)
export function exportProjectToIfc(project, allRooms, stairsList) {
  const w = new IfcWriter();
  const wallHeight = project?.wall_height ?? 2.7;
  const projectName = project?.name || "مشروع بلا اسم";

  const origin = point3(w, 0, 0, 0);
  const zAxis = w.add(`IFCDIRECTION((0.,0.,1.))`);
  const xAxis = w.add(`IFCDIRECTION((1.,0.,0.))`);
  const yAxis = w.add(`IFCDIRECTION((0.,1.,0.))`);
  const worldAxis = w.add(`IFCAXIS2PLACEMENT3D(#${origin},#${zAxis},#${xAxis})`);

  const person = w.add(`IFCPERSON($,$,'User',$,$,$,$,$)`);
  const org = w.add(`IFCORGANIZATION($,'${escapeStr(projectName)}',$,$,$)`);
  const personOrg = w.add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = w.add(`IFCAPPLICATION(#${org},'1.0','Architect Studio 360','AS360')`);
  const ownerHistory = w.add(`IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,0)`);

  const lenUnit = w.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const areaUnit = w.add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const volUnit = w.add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const angleUnit = w.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
  const units = w.add(`IFCUNITASSIGNMENT((#${lenUnit},#${areaUnit},#${volUnit},#${angleUnit}))`);

  const geomContext = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${worldAxis},#${yAxis})`);
  const ctx = { context: geomContext, zAxis, xAxis };

  const projectId = w.add(`IFCPROJECT('${randomIfcGuid()}',#${ownerHistory},'${escapeStr(projectName)}',$,$,$,$,(#${geomContext}),#${units})`);

  const sitePlacement = w.add(`IFCLOCALPLACEMENT($,#${worldAxis})`);
  const siteId = w.add(`IFCSITE('${randomIfcGuid()}',#${ownerHistory},'Site',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`);
  w.add(`IFCRELAGGREGATES('${randomIfcGuid()}',#${ownerHistory},$,$,#${projectId},(#${siteId}))`);

  const buildingPlacement = w.add(`IFCLOCALPLACEMENT(#${sitePlacement},#${worldAxis})`);
  const buildingId = w.add(`IFCBUILDING('${randomIfcGuid()}',#${ownerHistory},'${escapeStr(projectName)}',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES('${randomIfcGuid()}',#${ownerHistory},$,$,#${siteId},(#${buildingId}))`);

  const floors = [...new Set(allRooms.map((r) => r.floor ?? 0))].sort((a, b) => a - b);
  const floorsToExport = floors.length ? floors : [0];
  const floorBaseYMap = computeFloorBaseYMap(allRooms, wallHeight);
  const storeyIds = [];

  floorsToExport.forEach((floorNum) => {
    const floorRooms = allRooms.filter((r) => (r.floor ?? 0) === floorNum);
    const elevation = floorBaseYMap.get(floorNum) ?? 0;
    const elevPt = point3(w, 0, 0, elevation);
    const elevAxis = w.add(`IFCAXIS2PLACEMENT3D(#${elevPt},#${zAxis},#${xAxis})`);
    const storeyPlacement = w.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${elevAxis})`);
    const storeyId = w.add(
      `IFCBUILDINGSTOREY('${randomIfcGuid()}',#${ownerHistory},'${escapeStr(floorLabel(floorNum))}',$,$,#${storeyPlacement},$,$,.ELEMENT.,${fmt(elevation)})`
    );
    storeyIds.push(storeyId);

    const roomWallHeight = floorRooms[0]?.wall_height ?? wallHeight;
    const elementPlacement = w.add(`IFCLOCALPLACEMENT(#${storeyPlacement},#${worldAxis})`);
    const elementIds = [];

    floorRooms.forEach((room) => {
      addRoomWallsAndSlabs(w, ctx, room, room.wall_height ?? roomWallHeight, ownerHistory, elementPlacement, elementIds);
    });

    (stairsList || []).filter((s) => (s.floor ?? 0) === floorNum).forEach((s) => {
      addStair(w, ctx, s, allRooms, wallHeight, ownerHistory, elementPlacement, elementIds);
    });

    if (elementIds.length) {
      w.add(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE('${randomIfcGuid()}',#${ownerHistory},$,$,(${elementIds.map((id) => `#${id}`).join(",")}),#${storeyId})`
      );
    }
  });

  w.add(`IFCRELAGGREGATES('${randomIfcGuid()}',#${ownerHistory},$,$,#${buildingId},(${storeyIds.map((id) => `#${id}`).join(",")}))`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    `FILE_NAME('${escapeStr(projectName)}.ifc','${new Date().toISOString()}',(''),(''),'Architect Studio 360','Architect Studio 360','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "",
    "DATA;",
  ].join("\n");

  const footer = ["ENDSEC;", "", "END-ISO-10303-21;", ""].join("\n");

  return [header, w.lines.join("\n"), footer].join("\n");
}
