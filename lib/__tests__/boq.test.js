import { describe, it, expect } from "vitest";
import { computeBoqItems } from "../boq";

function byKey(items, key) {
  return items.find((i) => i.key === key).quantity;
}

describe("computeBoqItems", () => {
  it("مشروع فاضي: كل الكميات صفر بلا انهيار", () => {
    const items = computeBoqItems([], []);
    expect(byKey(items, "area")).toBe(0);
    expect(byKey(items, "wallLength")).toBe(0);
    expect(byKey(items, "rooms")).toBe(0);
    expect(byKey(items, "floors")).toBe(0);
  });

  it("غرفة مستطيلة وحيدة: المساحة والمحيط الكامل (بلا جيران لطرحهم)", () => {
    const room = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 5, has_roof: true, openings: [] };
    const items = computeBoqItems([room], []);
    expect(byKey(items, "area")).toBe(20);
    expect(byKey(items, "wallLength")).toBe(18); // 2*(4+5)
    expect(byKey(items, "roofArea")).toBe(20);
    expect(byKey(items, "rooms")).toBe(1);
    expect(byKey(items, "floors")).toBe(1);
  });

  it("غرفتان متلاصقتان بالكامل: الجدار المشترك يُحسب مرة وحدة بس", () => {
    const a = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4, has_roof: false, openings: [] };
    const b = { id: "b", floor: 0, gx: 4, gy: 0, gw: 4, gh: 4, has_roof: false, openings: [] };
    const items = computeBoqItems([a, b], []);
    // مجموع المحيطين = 16+16=32، الجزء المشترك (ضلع بطول 4) بيتطرح مرة وحدة → 32-4=28
    expect(byKey(items, "wallLength")).toBe(28);
    expect(byKey(items, "area")).toBe(32);
  });

  it("غرفة بلا سطح (شرفة): ما بتنضاف لمساحة الأسطح", () => {
    const room = { id: "a", floor: 0, gx: 0, gy: 0, gw: 3, gh: 3, has_roof: false, openings: [] };
    const items = computeBoqItems([room], []);
    expect(byKey(items, "roofArea")).toBe(0);
    expect(byKey(items, "area")).toBe(9);
  });

  it("يعدّ الأبواب والنوافذ بشكل منفصل من كل الغرف والطوابق", () => {
    const rooms = [
      { id: "a", floor: 0, gx: 0, gy: 0, gw: 3, gh: 3, has_roof: true, openings: [{ kind: "door" }, { kind: "window" }, { kind: "window" }] },
      { id: "b", floor: 1, gx: 0, gy: 0, gw: 3, gh: 3, has_roof: true, openings: [{ kind: "door" }] },
    ];
    const items = computeBoqItems(rooms, []);
    expect(byKey(items, "doors")).toBe(2);
    expect(byKey(items, "windows")).toBe(2);
    expect(byKey(items, "floors")).toBe(2);
  });

  it("غرفة حرة الشكل: محيطها الكامل (مثلث) بلا طرح — بلا جدران مشتركة بالغرف الحرة أصلاً", () => {
    const room = { id: "a", floor: 0, gx: 0, gy: 0, gw: 6, gh: 4, has_roof: false, openings: [], points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 4 }] };
    const items = computeBoqItems([room], []);
    const expectedPerimeter = 6 + 4 + Math.hypot(6, 4);
    expect(byKey(items, "wallLength")).toBeCloseTo(expectedPerimeter, 2);
  });

  it("عدد السلالم = طول قائمة السلالم", () => {
    const items = computeBoqItems([], [{ id: "s1" }, { id: "s2" }]);
    expect(byKey(items, "stairs")).toBe(2);
  });

  it("مشروع فاضي: بنود الخرسانة والحديد صفر بلا انهيار", () => {
    const items = computeBoqItems([], []);
    expect(byKey(items, "concreteSlabs")).toBe(0);
    expect(byKey(items, "concreteBeams")).toBe(0);
    expect(byKey(items, "rebar")).toBe(0);
  });

  it("غرفة مستطيلة وحيدة: خرسانة البلاطة/الكمرة والحديد التقديري يطابقوا التقدير الإنشائي يدوياً", () => {
    const room = { id: "a", floor: 0, gx: 0, gy: 0, gw: 4, gh: 5, has_roof: true, openings: [] };
    const items = computeBoqItems([room], []);
    // سماكة البلاطة: max(120, ceil(4000/26 → 153.8 → 160)) = 160مم؛ حجم = 20م² × 0.16 = 3.2م³
    expect(byKey(items, "concreteSlabs")).toBeCloseTo(3.2, 5);
    // الكمرة: عمق max(250, ceil(5000/12 → 416.7 → 420))=420مم، عرض max(200, ceil(420/2→210))=210مم
    // حجم = محيط(18م) × 0.21 × 0.42 = 1.5876م³
    expect(byKey(items, "concreteBeams")).toBeCloseTo(1.59, 2);
    // حديد = 3.2×80 + 1.5876×110 ≈ 430.6 → مقرّب لأقرب كغ
    expect(byKey(items, "rebar")).toBe(431);
  });
});
