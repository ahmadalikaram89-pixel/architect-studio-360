// اختبارات دمج الجدران المشتركة للغرف الحرة الشكل (حر↔حر وحر↔مستطيل). الحالة المستطيلة
// ↔المستطيلة مغطّاة أصلاً بـbuild3d.test.js عبر المسار القديم — وفي هون اختبار صريح إنه
// المسار الجديد **ما** بيرجعها، لأن أي تداخل بين المسارين معناه جدار مبني مرتين بعرض 3D
// وطول جدران مخصوم مرتين بجدول الكميات.
import { describe, it, expect } from "vitest";
import {
  roomEdges, edgeOverlap, computePolygonSharedBoundaries, addPolygonSharedRanges,
  sharedWallRanges, computeSharedBoundaries, wallRangeKey,
} from "../build3d";
import { computeBoqItems } from "../boq";

// مربع كغرفة حرة الشكل (points) — نفس هندسة المستطيل بس بمسار الشكل الحر
const polySquare = (id, x, y, size, extra = {}) => ({
  id, floor: 0, points: [
    { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
  ],
  gx: x, gy: y, gw: size, gh: size, ...extra,
});
const rect = (id, gx, gy, gw, gh, extra = {}) => ({ id, floor: 0, gx, gy, gw, gh, ...extra });

describe("roomEdges", () => {
  it("بيرجع أضلاع المضلع بنفس ترتيب واتجاه edge_index", () => {
    const edges = roomEdges(polySquare("a", 0, 0, 4));
    expect(edges).toHaveLength(4);
    expect(edges[1]).toMatchObject({ edgeIndex: 1, p1: { x: 4, y: 0 }, p2: { x: 4, y: 4 }, length: 4 });
    expect(edges[1].wall).toBeNull();
  });

  it("بيرجع جدران المستطيل الأربعة باتجاه بيطابق مرجع قياس position للفتحات", () => {
    const edges = roomEdges(rect("r", 2, 3, 6, 4));
    const byWall = Object.fromEntries(edges.map((e) => [e.wall, e]));
    // top/bottom بتُقاس من gx، وleft/right من gy — نفس openingMarkPoints بالضبط
    expect(byWall.top).toMatchObject({ p1: { x: 2, y: 3 }, p2: { x: 8, y: 3 }, length: 6 });
    expect(byWall.bottom).toMatchObject({ p1: { x: 2, y: 7 }, p2: { x: 8, y: 7 } });
    expect(byWall.left).toMatchObject({ p1: { x: 2, y: 3 }, p2: { x: 2, y: 7 }, length: 4 });
    expect(byWall.right).toMatchObject({ p1: { x: 8, y: 3 }, p2: { x: 8, y: 7 } });
  });
});

describe("edgeOverlap", () => {
  const edge = (x1, y1, x2, y2) => ({
    p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, length: Math.hypot(x2 - x1, y2 - y1),
  });

  it("ضلع مايل مشترك كامل بالاتجاه المعاكس — الحالة الطبيعية لغرفتين متجاورتين", () => {
    const ov = edgeOverlap(edge(0, 0, 4, 2), edge(4, 2, 0, 0));
    const len = Math.hypot(4, 2);
    expect(ov.length).toBeCloseTo(len, 6);
    expect(ov.flipped).toBe(true);
    expect(ov.a).toEqual({ start: 0, end: expect.closeTo(len, 6) });
    expect(ov.b.start).toBeCloseTo(0, 6);
    expect(ov.b.end).toBeCloseTo(len, 6);
  });

  it("تراكب جزئي على ضلع مايل — الجزء المتراكب فعلياً بس", () => {
    const ov = edgeOverlap(edge(0, 0, 4, 2), edge(2, 1, 4, 2));
    expect(ov.flipped).toBe(false);
    expect(ov.a.start).toBeCloseTo(Math.hypot(2, 1), 6);
    expect(ov.a.end).toBeCloseTo(Math.hypot(4, 2), 6);
    expect(ov.length).toBeCloseTo(Math.hypot(2, 1), 6);
    expect(ov.b).toEqual({ start: expect.closeTo(0, 6), end: expect.closeTo(Math.hypot(2, 1), 6) });
    // نقطتا الجزء المشترك بالعالم
    expect(ov.p1.x).toBeCloseTo(2, 6);
    expect(ov.p1.y).toBeCloseTo(1, 6);
  });

  it("ضلعان متوازيان بس مو على نفس الخط — مو جدار مشترك", () => {
    expect(edgeOverlap(edge(0, 0, 4, 0), edge(0, 0.5, 4, 0.5))).toBeNull();
  });

  it("تلامس بزاوية (نقطة وحدة، بلا طول) — مو جدار مشترك", () => {
    expect(edgeOverlap(edge(0, 0, 4, 0), edge(4, 0, 8, 0))).toBeNull();
  });

  it("انحراف عمودي أصغر من حد التسامح بينعدّ نفس الجدار (رسم حر بلا التصاق تام بالشبكة)", () => {
    expect(edgeOverlap(edge(0, 0, 4, 0), edge(4, 0.005, 0, 0.005))).not.toBeNull();
    expect(edgeOverlap(edge(0, 0, 4, 0), edge(4, 0.05, 0, 0.05))).toBeNull();
  });
});

describe("computePolygonSharedBoundaries", () => {
  it("غرفتان حرتان متلاصقتان: حد واحد بالضبط، بالأضلاع الصحيحة من الطرفين", () => {
    const a = polySquare("a", 0, 0, 4), b = polySquare("b", 4, 0, 4);
    const bounds = computePolygonSharedBoundaries([a, b]);
    expect(bounds).toHaveLength(1);
    expect(bounds[0].a).toMatchObject({ edgeIndex: 1, start: 0, end: 4 });
    expect(bounds[0].b).toMatchObject({ edgeIndex: 3, start: 0, end: 4 });
    expect(bounds[0].length).toBe(4);
    expect(bounds[0].flipped).toBe(true);
  });

  it("غرفة حرة ملاصقة لمستطيل — الحد بينمسك من الطرفين (ضلع من جهة، جدار مسمّى من الجهة التانية)", () => {
    const bounds = computePolygonSharedBoundaries([polySquare("p", 0, 0, 4), rect("r", 4, 0, 4, 4)]);
    expect(bounds).toHaveLength(1);
    expect(bounds[0].a).toMatchObject({ edgeIndex: 1, wall: null });
    expect(bounds[0].b).toMatchObject({ wall: "left", edgeIndex: null, start: 0, end: 4 });
  });

  it("تلامس جزئي — الجزء المتراكب بس", () => {
    const bounds = computePolygonSharedBoundaries([polySquare("p", 0, 0, 4), rect("r", 4, 2, 4, 6)]);
    expect(bounds).toHaveLength(1);
    expect(bounds[0].length).toBe(2);
    expect(bounds[0].a).toMatchObject({ start: 2, end: 4 }); // بإحداثي ضلع المضلع
    expect(bounds[0].b).toMatchObject({ start: 0, end: 2 }); // بإحداثي جدار المستطيل (من gy)
  });

  it("**ما بيرجع أزواج مستطيل↔مستطيل** — هدول حصرياً للمسار القديم، وإلا الجدار بينبنى وبينخصم مرتين", () => {
    expect(computePolygonSharedBoundaries([rect("a", 0, 0, 4, 4), rect("b", 4, 0, 4, 4)])).toHaveLength(0);
    // نفس الزوج بالضبط بيمسكه المسار القديم
    expect(computeSharedBoundaries([rect("a", 0, 0, 4, 4), rect("b", 4, 0, 4, 4)])).toHaveLength(1);
  });

  it("غرف بطوابق مختلفة ما بتشارك جدران", () => {
    const a = polySquare("a", 0, 0, 4), b = { ...polySquare("b", 4, 0, 4), floor: 1 };
    expect(computePolygonSharedBoundaries([a, b])).toHaveLength(0);
  });

  it("غرفتان بعيدتان — بلا حدود", () => {
    expect(computePolygonSharedBoundaries([polySquare("a", 0, 0, 4), polySquare("b", 9, 0, 4)])).toHaveLength(0);
  });
});

describe("addPolygonSharedRanges", () => {
  it("بتدمج فترات الأضلاع الحرة بنفس خريطة الجدران المستطيلة بلا ما تدعس عليها", () => {
    const rectBounds = computeSharedBoundaries([rect("r1", 0, 0, 4, 4), rect("r2", 0, 4, 4, 4)]);
    const map = sharedWallRanges(rectBounds);
    expect(map.get(wallRangeKey("r1", "bottom", null))).toEqual([{ start: 0, end: 4 }]);

    const polyBounds = computePolygonSharedBoundaries([polySquare("p", 0, 0, 4), rect("r1", 4, 0, 4, 4)]);
    addPolygonSharedRanges(map, polyBounds);
    expect(map.get(wallRangeKey("r1", "bottom", null))).toEqual([{ start: 0, end: 4 }]); // ما تغيّرت
    expect(map.get(wallRangeKey("p", null, 1))).toEqual([{ start: 0, end: 4 }]);
    expect(map.get(wallRangeKey("r1", "left", null))).toEqual([{ start: 0, end: 4 }]);
  });
});

describe("جدول الكميات — الجدار المشترك للغرف الحرة بينحسب مرة وحدة", () => {
  const wallLen = (rooms) => computeBoqItems(rooms, []).find((i) => i.key === "wallLength").quantity;

  it("غرفتان حرتان متلاصقتان: 4م تنخصم مرة وحدة من مجموع المحيطين", () => {
    const a = polySquare("a", 0, 0, 4), b = polySquare("b", 4, 0, 4);
    expect(wallLen([a])).toBe(16);
    expect(wallLen([a, b])).toBe(16 + 16 - 4);
  });

  it("غرفة حرة ملاصقة لمستطيل — نفس الخصم", () => {
    expect(wallLen([polySquare("p", 0, 0, 4), rect("r", 4, 0, 4, 4)])).toBe(16 + 16 - 4);
  });

  it("غرفتان حرتان مو متلاصقتين — بلا أي خصم", () => {
    expect(wallLen([polySquare("a", 0, 0, 4), polySquare("b", 9, 0, 4)])).toBe(32);
  });
});
