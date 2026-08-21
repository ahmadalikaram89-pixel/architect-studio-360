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
});
