import { describe, it, expect } from "vitest";
import {
  snap, clamp, floorLabel, pointSegDist, roomCentroid, pointInPolygon,
  furnitureFootprint, hitTestRoomForFurniture, stairEffectiveFootprint, floorToFloorHeight,
} from "../planGeometry";

describe("snap/clamp/floorLabel", () => {
  it("snap يقرّب لأقرب مضاعف للخطوة", () => {
    expect(snap(1.24, 0.5)).toBe(1.0);
    expect(snap(1.26, 0.5)).toBe(1.5);
    expect(snap(3, 0.5)).toBe(3);
  });

  it("clamp يحصر القيمة بين حدين", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it("floorLabel بيرجع اسم عربي للطوابق المعروفة، ورقم عام لما بعدها", () => {
    expect(floorLabel(0)).toBe("الطابق الأرضي");
    expect(floorLabel(1)).toBe("الطابق الأول");
    expect(floorLabel(99)).toBe("الطابق 99");
  });
});

describe("pointSegDist", () => {
  it("المسافة صفر لنقطة على القطعة نفسها", () => {
    const { dist, t } = pointSegDist(5, 0, 0, 0, 10, 0);
    expect(dist).toBeCloseTo(0);
    expect(t).toBeCloseTo(0.5);
  });

  it("t بينحصر بين 0 و1 حتى لو النقطة خارج امتداد القطعة", () => {
    const { dist, t } = pointSegDist(-5, 3, 0, 0, 10, 0);
    expect(t).toBe(0);
    expect(dist).toBeCloseTo(Math.hypot(5, 3));
  });

  it("مسافة عمودية صحيحة لنقطة فوق منتصف قطعة أفقية", () => {
    const { dist } = pointSegDist(5, 4, 0, 0, 10, 0);
    expect(dist).toBeCloseTo(4);
  });
});

describe("roomCentroid", () => {
  it("مركز غرفة مستطيلة = منتصف الأبعاد", () => {
    expect(roomCentroid({ gx: 2, gy: 3, gw: 4, gh: 6 })).toEqual({ x: 4, y: 6 });
  });

  it("مركز غرفة حرة الشكل = معدّل الرؤوس", () => {
    const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    expect(roomCentroid({ points })).toEqual({ x: 2, y: 2 });
  });
});

describe("pointInPolygon", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("نقطة جوّا المضلع", () => {
    expect(pointInPolygon(square, 5, 5)).toBe(true);
  });

  it("نقطة برّا المضلع", () => {
    expect(pointInPolygon(square, 15, 5)).toBe(false);
  });

  it("نقطة برّا بس بمحاذاة أحد المحاور (تأكيد ما في false positive)", () => {
    expect(pointInPolygon(square, 5, -5)).toBe(false);
    expect(pointInPolygon(square, -5, 5)).toBe(false);
  });
});

describe("furnitureFootprint", () => {
  it("بلا دوران: نفس أبعاد الكتالوج", () => {
    expect(furnitureFootprint("bed", 0)).toEqual({ w: 1.6, d: 2.0 });
  });

  it("دوران 90/270: تبادل العرض والعمق", () => {
    expect(furnitureFootprint("bed", 90)).toEqual({ w: 2.0, d: 1.6 });
    expect(furnitureFootprint("bed", 270)).toEqual({ w: 2.0, d: 1.6 });
  });

  it("دوران 180: بلا تبادل", () => {
    expect(furnitureFootprint("bed", 180)).toEqual({ w: 1.6, d: 2.0 });
  });

  it("نوع غير معروف: أبعاد افتراضية آمنة بدل انهيار", () => {
    expect(furnitureFootprint("not_a_real_kind", 0)).toEqual({ w: 0.5, d: 0.5 });
  });
});

describe("hitTestRoomForFurniture", () => {
  const rectRoom = { id: "r1", gx: 0, gy: 0, gw: 5, gh: 5, furniture: [] };

  it("بتحط قطعة جوّا غرفة مستطيلة وتحصرها بحدودها", () => {
    const res = hitTestRoomForFurniture([rectRoom], 4.9, 4.9, "chair");
    expect(res.roomId).toBe("r1");
    expect(res.x).toBeLessThanOrEqual(5 - 0.225);
    expect(res.y).toBeLessThanOrEqual(5 - 0.225);
  });

  it("بترفض لو القطعة أكبر من الغرفة", () => {
    const tinyRoom = { id: "r2", gx: 0, gy: 0, gw: 1, gh: 1, furniture: [] };
    expect(hitTestRoomForFurniture([tinyRoom], 0.5, 0.5, "bed")).toBeNull();
  });

  it("بترفض لو في تراكب مع قطعة موجودة أصلاً", () => {
    const occupied = { id: "r3", gx: 0, gy: 0, gw: 5, gh: 5, furniture: [{ id: "f1", kind: "chair", x: 2.5, y: 2.5, rotation: 0 }] };
    expect(hitTestRoomForFurniture([occupied], 2.5, 2.5, "chair")).toBeNull();
  });

  it("غرفة حرة الشكل: احتواء عبر point-in-polygon", () => {
    const polyRoom = { id: "r4", gx: 0, gy: 0, gw: 6, gh: 6, points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }], furniture: [] };
    expect(hitTestRoomForFurniture([polyRoom], 3, 3, "chair").roomId).toBe("r4");
    expect(hitTestRoomForFurniture([polyRoom], 20, 20, "chair")).toBeNull();
  });
});

describe("stairEffectiveFootprint / floorToFloorHeight", () => {
  it("دوران 90/270 بيبادل عرض/عمق السلم", () => {
    const straight = stairEffectiveFootprint(3, 0);
    const rotated = stairEffectiveFootprint(3, 90);
    expect(rotated).toEqual({ w: straight.d, d: straight.w });
  });

  it("ارتفاع الطابق = فرق قاعدة Y بين الطابق والي فوقه", () => {
    const rooms = [{ floor: 0, wall_height: 3 }];
    expect(floorToFloorHeight(rooms, 0, 2.7)).toBeCloseTo(3 + 0.18);
  });
});
