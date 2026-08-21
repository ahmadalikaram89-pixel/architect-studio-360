// تقدير إنشائي أولي — قواعد الإبهام السريعة (rule-of-thumb) المستخدمة بمرحلة التصميم
// المفاهيمي المبكر (قبل ما يدخل المهندس الإنشائي أصلاً)، مبنية على نسب باع/عمق معيارية
// شائعة الاستخدام (بلاطة خرسانية باتجاهين ≈ الباع/26، كمرة بسيطة الاستناد ≈ الباع/12).
//
// **تحذير سلامة صريح — هاد مو تصميم إنشائي معتمد**: القيم هون تقديرية جداً لغايات
// التصميم المفاهيمي بس (مساعدة معمارية سريعة لتصوّر الأبعاد قبل إشراك مهندس إنشائي) —
// بلا أي حساب أحمال فعلي حسب كود بناء، بلا تفاصيل تسليح، بلا تحقق من حالات تحميل متعددة،
// وبلا اعتبار لنوع التربة أو الزلازل أو الرياح. أي مشروع بناء فعلي لازم يمرّ بمراجعة وتصميم
// من مهندس إنشائي مرخّص قبل التنفيذ — هاد الملف بلا استثناء لا يُستخدم كبديل عن هيك مراجعة.
import { roomArea } from "./build3d";

const SLAB_SPAN_RATIO = 26; // بلاطة خرسانية باتجاهين، استناد بسيط — قيمة معيارية شائعة
const SLAB_MIN_MM = 120;
const BEAM_SPAN_RATIO = 12; // كمرة خرسانية بسيطة الاستناد — قيمة معيارية شائعة
const BEAM_MIN_DEPTH_MM = 250;
const BEAM_MIN_WIDTH_MM = 200;
const LOAD_PER_FLOOR_KNM2 = 12; // تقدير حمل ميت+حي مجمّع تقريبي لكل طابق (خرسانة سكنية نموذجية)
const CONCRETE_FC_MPA = 25; // مقاومة خرسانة نموذجية C25
const COLUMN_ALLOWABLE_STRESS_MPA = 0.4 * CONCRETE_FC_MPA; // تبسيط شديد لغايات التقدير الأولي بس
const COLUMN_MIN_MM = 250;

function roundUpTo(v, step) {
  return Math.ceil(v / step) * step;
}

function estimateSlabThicknessMm(shortSpanM) {
  return Math.max(SLAB_MIN_MM, roundUpTo((shortSpanM * 1000) / SLAB_SPAN_RATIO, 10));
}

function estimateBeamMm(longSpanM) {
  const depth = Math.max(BEAM_MIN_DEPTH_MM, roundUpTo((longSpanM * 1000) / BEAM_SPAN_RATIO, 10));
  const width = Math.max(BEAM_MIN_WIDTH_MM, roundUpTo(depth / 2, 10));
  return { depth, width };
}

// عمود "نموذجي" واحد بس (توضيحي، مو مواقع أعمدة فعلية — البرنامج ما بيحدد مواقع أعمدة
// إطلاقاً) — يفترض عمود يخدم أكبر فراغ (بحيّز/tributary area) موجود بالمخطط، عبر كل الطوابق
function estimateTypicalColumn(maxRoomAreaM2, floorCount) {
  if (!(maxRoomAreaM2 > 0) || !(floorCount > 0)) return null;
  const loadKN = maxRoomAreaM2 * floorCount * LOAD_PER_FLOOR_KNM2;
  const requiredAreaMm2 = (loadKN * 1000) / COLUMN_ALLOWABLE_STRESS_MPA;
  const sideMm = Math.max(COLUMN_MIN_MM, roundUpTo(Math.sqrt(requiredAreaMm2), 10));
  return { sideMm, loadKN: Math.round(loadKN), basedOnAreaM2: Math.round(maxRoomAreaM2 * 10) / 10, floorCount };
}

// rooms: كل غرف المشروع (كل الطوابق)؛ بيرجع تقدير لكل غرفة (سماكة بلاطة + أبعاد كمرة محيطية)
// وتقدير عمود نموذجي وحيد يمثّل أكبر فراغ بالمشروع
export function computeStructuralEstimate(rooms) {
  const roomsItems = rooms.map((r) => {
    const shortSpan = Math.min(r.gw, r.gh);
    const longSpan = Math.max(r.gw, r.gh);
    const beam = estimateBeamMm(longSpan);
    return {
      roomId: r.id,
      name: r.name,
      floor: r.floor ?? 0,
      area: roomArea(r),
      shortSpan,
      longSpan,
      slabThicknessMm: estimateSlabThicknessMm(shortSpan),
      beamDepthMm: beam.depth,
      beamWidthMm: beam.width,
    };
  });

  const floorCount = new Set(rooms.map((r) => r.floor ?? 0)).size;
  const maxRoomArea = roomsItems.reduce((m, r) => Math.max(m, r.area), 0);
  const column = estimateTypicalColumn(maxRoomArea, floorCount);

  return { rooms: roomsItems, column };
}
