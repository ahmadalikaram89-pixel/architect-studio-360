// جدول كميات (BOQ) أولي — دوال صرفة بلا React، بتحسب الكميات مباشرة من بيانات التصميم
// الموجودة أصلاً (rooms/openings/stairs)، بلا أي عمود جديد بقاعدة البيانات ولا أي حالة إضافية.
// تقدير أولي بس (مقصود ومُعلن للمستخدم) — مو بديل عن جدول كميات هندسي معتمد من مكتب حساب كميات.
import { roomArea, computeSharedBoundaries } from "./build3d";
import { computeStructuralEstimate } from "./structural";

// نسب حديد تسليح تقريبية شائعة بمراحل التسعير المبكرة (كغ حديد لكل م³ خرسانة) — مو نتيجة
// حساب تسليح فعلي، مجرد قاعدة إبهام تناسب أبعاد البلاطة/الكمرة المقدّرة أصلاً بـ lib/structural.js.
// نفس تحذير السلامة هناك ينطبق هون بالكامل: تقدير مفاهيمي بس، لازم مراجعة مهندس إنشائي مرخّص.
const SLAB_REBAR_KG_PER_M3 = 80;
const BEAM_REBAR_KG_PER_M3 = 110;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function average(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function rectPerimeter(room) {
  return 2 * (room.gw + room.gh);
}

function polygonPerimeter(room) {
  const pts = room.points;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

// طول الجدران الصافي بطابق معيّن — مجموع محيط كل غرفة مستطيلة ناقص طول الأجزاء المشتركة
// (كل جدار مشترك بين غرفتين متلاصقتين محسوب مرة وحدة بس، مو مرتين). الغرف الحرة الشكل
// بلا جدران مشتركة أصلاً (قيد موثّق بمكان تاني بالمشروع)، فمحيطها الكامل يُضاف مباشرة.
function floorWallLength(floorRooms) {
  const rectRooms = floorRooms.filter((r) => !r.points);
  const polyRooms = floorRooms.filter((r) => r.points && r.points.length >= 3);

  const rawPerimeterSum = rectRooms.reduce((s, r) => s + rectPerimeter(r), 0);
  const boundaries = computeSharedBoundaries(rectRooms);
  const sharedSum = boundaries.reduce((s, b) => s + (b.end - b.start), 0);
  const polyPerimeterSum = polyRooms.reduce((s, r) => s + polygonPerimeter(r), 0);

  return (rawPerimeterSum - sharedSum) + polyPerimeterSum;
}

// بنود جدول الكميات لكل التصميم (كل الطوابق) — كل بند {key, label, unit, quantity}،
// بلا أسعار (الأسعار بتُدخل بواجهة المستخدم لاحقاً، بتفرق كتير حسب السوق المحلي)
export function computeBoqItems(rooms, stairsList) {
  const floors = [...new Set(rooms.map((r) => r.floor ?? 0))];
  const structural = computeStructuralEstimate(rooms);
  const structuralByRoom = new Map(structural.rooms.map((r) => [r.roomId, r]));

  let totalArea = 0;
  let totalWallLength = 0;
  let roofArea = 0;
  let doorCount = 0;
  let windowCount = 0;
  let beamVolumeM3 = 0;

  floors.forEach((floorNum) => {
    const floorRooms = rooms.filter((r) => (r.floor ?? 0) === floorNum);
    const floorWallLen = floorWallLength(floorRooms);
    totalWallLength += floorWallLen;

    // حجم خرسانة الكمرات المحيطية لهاد الطابق: طول الجدران الصافي (نفس القيمة المطروح
    // منها الجدار المشترك أعلاه) × متوسط أبعاد الكمرة المقدّرة لغرف هاد الطابق (lib/structural.js)
    // — تقريب معقول بما إنه الكمرات بتتبع خطوط الجدران أصلاً، بلا تكرار الجزء المشترك
    const floorStructRooms = floorRooms.map((r) => structuralByRoom.get(r.id)).filter(Boolean);
    if (floorStructRooms.length > 0) {
      const avgBeamWidthM = average(floorStructRooms.map((r) => r.beamWidthMm)) / 1000;
      const avgBeamDepthM = average(floorStructRooms.map((r) => r.beamDepthMm)) / 1000;
      beamVolumeM3 += floorWallLen * avgBeamWidthM * avgBeamDepthM;
    }

    floorRooms.forEach((r) => {
      const area = roomArea(r);
      totalArea += area;
      if (r.has_roof) roofArea += area;
      doorCount += (r.openings || []).filter((o) => o.kind === "door").length;
      windowCount += (r.openings || []).filter((o) => o.kind === "window").length;
    });
  });

  // حجم خرسانة البلاطات: مساحة كل غرفة × سماكة بلاطتها المقدّرة (لا تكرار محتمل هون —
  // كل غرفة بلاطتها لحالها، بعكس الجدران/الكمرات المشتركة بين غرفتين متلاصقتين)
  const slabVolumeM3 = structural.rooms.reduce((s, r) => s + r.area * (r.slabThicknessMm / 1000), 0);
  const rebarKg = slabVolumeM3 * SLAB_REBAR_KG_PER_M3 + beamVolumeM3 * BEAM_REBAR_KG_PER_M3;

  return [
    { key: "area", label: "مساحة البناء الإجمالية", unit: "م²", quantity: round2(totalArea) },
    { key: "wallLength", label: "طول الجدران (صافي، بلا تكرار المشترك)", unit: "م طولي", quantity: round2(totalWallLength) },
    { key: "roofArea", label: "مساحة الأسطح المغطاة", unit: "م²", quantity: round2(roofArea) },
    { key: "doors", label: "عدد الأبواب", unit: "قطعة", quantity: doorCount },
    { key: "windows", label: "عدد النوافذ", unit: "قطعة", quantity: windowCount },
    { key: "stairs", label: "عدد السلالم", unit: "قطعة", quantity: stairsList.length },
    { key: "rooms", label: "عدد الغرف", unit: "غرفة", quantity: rooms.length },
    { key: "floors", label: "عدد الطوابق", unit: "طابق", quantity: floors.length },
    { key: "concreteSlabs", label: "خرسانة البلاطات (من التقدير الإنشائي)", unit: "م³", quantity: round2(slabVolumeM3) },
    { key: "concreteBeams", label: "خرسانة الكمرات المحيطية (من التقدير الإنشائي)", unit: "م³", quantity: round2(beamVolumeM3) },
    { key: "rebar", label: "حديد تسليح تقديري (بلاطات وكمرات)", unit: "كغ", quantity: Math.round(rebarKg) },
  ];
}
