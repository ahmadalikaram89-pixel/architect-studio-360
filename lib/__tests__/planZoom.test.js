// اختبارات زوم/تحريك المخطط 2D — الجزء الصرف منه (بلا DOM): حساب زوم الملاءمة، حصر المدى،
// وتحويل إحداثيات المؤشر لمتر. التحويل تحديداً هو نقطة الفشل الأخطر بهالميزة: أي خطأ فيه
// بيخلي الرسم ينحط بمكان غلط عند أي تكبير غير 100% — فهو مغطّى هون بزوم مختلف لكل حالة.
import { describe, it, expect } from "vitest";
import {
  PPM, MIN_ZOOM, MAX_ZOOM, clampZoom, computeFitZoom, clientToPlanMeters,
} from "../planGeometry";

describe("clampZoom", () => {
  it("بيحصر ضمن المدى المسموح", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
  });

  it("بيرجع 1 لأي قيمة غير رقمية (حماية من قسمة على صفر بحساب القرصة)", () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
    expect(clampZoom(-Infinity)).toBe(1);
    expect(clampZoom(undefined)).toBe(1);
  });
});

describe("computeFitZoom", () => {
  it("بيصغّر لما المخطط أكبر من الحاوية — البُعد الأضيق هو يلي بيحكم", () => {
    // أرض 20×15م = 640×480 بكسل مخطط، بحاوية 400×400 (ناقص هامش 32)
    const z = computeFitZoom(400, 400, 20, 15);
    expect(z).toBeCloseTo((400 - 32) / 640, 5);
    expect(20 * PPM * z).toBeLessThanOrEqual(400);
    expect(15 * PPM * z).toBeLessThanOrEqual(400);
  });

  it("بياخد الارتفاع لما هو الأضيق", () => {
    expect(computeFitZoom(2000, 200, 20, 15)).toBeCloseTo((200 - 32) / 480, 5);
  });

  it("ما بيكبّر فوق 1 — عرض البداية بيضل مطابق للسلوك القديم (تصغير عند اللزوم بس)", () => {
    expect(computeFitZoom(4000, 4000, 6, 6)).toBe(1);
  });

  it("بيرجع 1 لقياسات حاوية صفرية (قبل أول قياس فعلي بالمتصفح)", () => {
    expect(computeFitZoom(0, 0, 20, 15)).toBe(1);
    expect(computeFitZoom(500, 0, 20, 15)).toBe(1);
  });

  it("ما بينزل تحت الحد الأدنى للزوم مهما صغرت الحاوية", () => {
    expect(computeFitZoom(40, 40, 60, 60)).toBe(MIN_ZOOM);
  });
});

describe("clientToPlanMeters", () => {
  // مستطيل الكانفاس كما بيقيسه المتصفح فعلياً — بيعكس الزوم أصلاً، فالتحويل ما بيحتاج
  // يعرف شي عن مستوى الزوم ولا عن كثافة بكسل الشاشة.
  const rectAt = (zoom, left = 0, top = 0) => ({
    left, top, width: 20 * PPM * zoom, height: 15 * PPM * zoom,
  });

  it("نفس نقطة الشاشة بتعطي نفس المتر بأي زوم", () => {
    for (const zoom of [0.25, 0.5, 1, 2.5, 6]) {
      const r = rectAt(zoom);
      // منتصف الكانفاس تماماً = منتصف الأرض
      const mid = clientToPlanMeters(r.width / 2, r.height / 2, r, 20, 15);
      expect(mid.x).toBeCloseTo(10, 6);
      expect(mid.y).toBeCloseTo(7.5, 6);
    }
  });

  it("بيحسب إزاحة الكانفاس على الشاشة (تمرير/تحريك)", () => {
    const r = rectAt(2, 120, 40);
    const p = clientToPlanMeters(120 + 2 * PPM * 2, 40 + 3 * PPM * 2, r, 20, 15);
    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(3, 6);
  });

  it("بيحصر ضمن حدود الأرض لما يطلع المؤشر برّا الكانفاس", () => {
    const r = rectAt(1);
    expect(clientToPlanMeters(-500, -500, r, 20, 15)).toEqual({ x: 0, y: 0 });
    expect(clientToPlanMeters(99999, 99999, r, 20, 15)).toEqual({ x: 20, y: 15 });
  });

  it("بيرجع نقطة الأصل لمستطيل بلا قياس (كانفاس لسا ما انرسم)", () => {
    expect(clientToPlanMeters(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 20, 15)).toEqual({ x: 0, y: 0 });
    expect(clientToPlanMeters(10, 10, null, 20, 15)).toEqual({ x: 0, y: 0 });
  });
});
