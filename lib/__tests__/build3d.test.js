import { describe, it, expect } from "vitest";
import { roomArea, computeCenter, computeFloorBaseYMap, computeSharedBoundaries, sharedWallRanges, stairFootprint, FURNITURE_KINDS, ROOF_T } from "../build3d";

describe("roomArea", () => {
  it("غرفة مستطيلة: gw × gh", () => {
    expect(roomArea({ gx: 0, gy: 0, gw: 4, gh: 5 })).toBe(20);
  });

  it("غرفة حرة الشكل: صيغة الحذاء (shoelace) — مربع 4×4", () => {
    const room = { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
    expect(roomArea(room)).toBe(16);
  });

  it("غرفة حرة الشكل: مثلث قائم الزاوية (0.5×قاعدة×ارتفاع)", () => {
    const room = { points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 4 }] };
    expect(roomArea(room)).toBe(12);
  });

  it("صيغة الحذاء بتشتغل بغض النظر عن اتجاه الدوران (CW أو CCW)", () => {
    const ccw = { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
    const cw = { points: [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 0 }] };
    expect(roomArea(cw)).toBe(roomArea(ccw));
  });
});

describe("computeFloorBaseYMap", () => {
  it("طابق وحيد: قاعدته صفر", () => {
    const map = computeFloorBaseYMap([{ floor: 0, wall_height: 2.7 }], 2.7);
    expect(map.get(0)).toBe(0);
  });

  it("طوابق متتالية: كل طابق يبلش من (قاعدة الي قبله + ارتفاعه + سماكة السقف)", () => {
    const rooms = [{ floor: 0, wall_height: 3 }, { floor: 1, wall_height: 2.5 }, { floor: 2, wall_height: 2.7 }];
    const map = computeFloorBaseYMap(rooms, 2.7);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBeGreaterThan(3); // 3 + سماكة السقف
    expect(map.get(2)).toBeGreaterThan(map.get(1) + 2.5);
  });

  it("minTopFloor بيضمن الخريطة تغطي طابق فوق أعلى غرفة موجودة (لازم للسلالم)", () => {
    const map = computeFloorBaseYMap([{ floor: 0, wall_height: 2.7 }], 2.7, 3);
    expect(map.has(3)).toBe(true);
  });
});

describe("computeSharedBoundaries + sharedWallRanges", () => {
  it("غرفتان متلاصقتان بالكامل على ضلع مشترك", () => {
    const a = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4 };
    const b = { id: "b", floor: 0, gx: 4, gy: 0, gw: 4, gh: 4 };
    const boundaries = computeSharedBoundaries([a, b]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].a.wall).toBe("right");
    expect(boundaries[0].b.wall).toBe("left");
    expect(boundaries[0].start).toBe(0);
    expect(boundaries[0].end).toBe(4);

    const ranges = sharedWallRanges(boundaries);
    expect(ranges.get("a:right")).toEqual([{ start: 0, end: 4 }]);
  });

  it("غرفتان بطوابق مختلفة: بلا حدود مشتركة حتى لو نفس الإحداثيات", () => {
    const a = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4 };
    const b = { id: "b", floor: 1, gx: 4, gy: 0, gw: 4, gh: 4 };
    expect(computeSharedBoundaries([a, b])).toHaveLength(0);
  });

  it("غرفتان بعيدتان عن بعض: بلا حدود مشتركة", () => {
    const a = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4 };
    const b = { id: "b", floor: 0, gx: 20, gy: 20, gw: 4, gh: 4 };
    expect(computeSharedBoundaries([a, b])).toHaveLength(0);
  });

  it("تلامس جزئي: طول الجزء المشترك بس، مو الضلع كامل", () => {
    const a = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 6 };
    const b = { id: "b", floor: 0, gx: 4, gy: 2, gw: 4, gh: 6 };
    const boundaries = computeSharedBoundaries([a, b]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].start).toBe(2);
    expect(boundaries[0].end).toBe(6);
  });
});

describe("stairFootprint", () => {
  it("بيرجع بعدين موجبين لأي ارتفاع طابق منطقي", () => {
    const { w, d } = stairFootprint(3);
    expect(w).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
  });
});

describe("FURNITURE_KINDS", () => {
  it("كل قطعة إلها label وأبعاد موجبة وcategory", () => {
    Object.entries(FURNITURE_KINDS).forEach(([kind, meta]) => {
      expect(meta.label, `${kind} بلا label`).toBeTruthy();
      expect(meta.w, `${kind} عرض غير موجب`).toBeGreaterThan(0);
      expect(meta.d, `${kind} عمق غير موجب`).toBeGreaterThan(0);
      expect(meta.category, `${kind} بلا category`).toBeTruthy();
    });
  });
});

// ====== تباعد الطوابق (وضع بيت الدمية) ======
// كل شي بالمشهد (جدران، أرضيات، أثاث، سلالم) بياخد موضعه العمودي من computeFloorBaseYMap،
// فالفجوة لازم تظهر كإزاحة تراكمية دقيقة هون — أي خطأ بالحساب بيفكّ الطوابق عن بعضها غلط
// أو بيخلي الأثاث يطفو/يغوص بأرضية الطابق
describe("computeFloorBaseYMap مع تباعد الطوابق", () => {
  const rooms = [
    { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4 },
    { id: "b", floor: 1, gx: 0, gy: 0, gw: 4, gh: 4 },
    { id: "c", floor: 2, gx: 0, gy: 0, gw: 4, gh: 4 },
  ];

  it("بلا فجوة = السلوك الطبيعي الملتصق (القيمة الافتراضية ما بتغيّر شي)", () => {
    const base = computeFloorBaseYMap(rooms, 3);
    const explicitZero = computeFloorBaseYMap(rooms, 3, 0, 0);
    expect([...base]).toEqual([...explicitZero]);
    expect(base.get(0)).toBe(0);
    expect(base.get(1)).toBeCloseTo(3 + ROOF_T, 6); // ارتفاع الجدار + سماكة البلاطة
  });

  it("الفجوة بتنضاف تراكمياً لكل طابق فوق الأرضي", () => {
    const gap = 1.5;
    const map = computeFloorBaseYMap(rooms, 3, 0, gap);
    const step = 3 + ROOF_T + gap;
    expect(map.get(0)).toBe(0); // الأرضي ما بيتحرك أبداً
    expect(map.get(1)).toBeCloseTo(step, 6);
    expect(map.get(2)).toBeCloseTo(step * 2, 6);
  });

  it("بتحترم ارتفاع جدار مختلف لكل طابق مع الفجوة", () => {
    const mixed = [
      { id: "a", floor: 0, wall_height: 4 },
      { id: "b", floor: 1, wall_height: 2.5 },
      { id: "c", floor: 2 },
    ];
    const map = computeFloorBaseYMap(mixed, 3, 0, 1);
    expect(map.get(1)).toBeCloseTo(4 + ROOF_T + 1, 6);
    expect(map.get(2)).toBeCloseTo(4 + ROOF_T + 1 + 2.5 + ROOF_T + 1, 6);
  });
});

describe("computeCenter مع تباعد الطوابق", () => {
  const rooms = [
    { id: "a", floor: 0, gx: 0, gy: 0, gw: 6, gh: 6 },
    { id: "b", floor: 1, gx: 0, gy: 0, gw: 6, gh: 6 },
  ];

  it("المبنى المفكوك أطول، فالكاميرا بتبعد وهدفها بيرتفع — وإلا بيطلع نصّه برّا الكادر", () => {
    const normal = computeCenter(rooms, 3);
    const spread = computeCenter(rooms, 3, 4);
    expect(spread.radius).toBeGreaterThan(normal.radius);
    expect(spread.targetY).toBeGreaterThan(normal.targetY);
    expect(spread.x).toBe(normal.x); // التوسيط الأفقي ما بيتأثر
    expect(spread.z).toBe(normal.z);
  });

  it("فجوة صفر = نفس التأطير القديم بالضبط", () => {
    expect(computeCenter(rooms, 3, 0)).toEqual(computeCenter(rooms, 3));
  });
});
