import { describe, it, expect } from "vitest";
import { computeStructuralEstimate } from "../structural";

describe("computeStructuralEstimate", () => {
  it("مشروع فاضي: بلا انهيار، عمود null", () => {
    const est = computeStructuralEstimate([]);
    expect(est.rooms).toEqual([]);
    expect(est.column).toBeNull();
  });

  it("غرفة مربعة 6×6: سماكة البلاطة = الباع الأقصر/26، مقرّبة لأعلى مضاعف 10مم", () => {
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 6, gh: 6 }];
    const est = computeStructuralEstimate(rooms);
    // 6000مم/26 = 230.77 → تقريب لأعلى 240
    expect(est.rooms[0].slabThicknessMm).toBe(240);
  });

  it("غرفة صغيرة جداً: السماكة ما تنزل تحت الحد الأدنى 120مم", () => {
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 1.5, gh: 1.5 }];
    const est = computeStructuralEstimate(rooms);
    expect(est.rooms[0].slabThicknessMm).toBe(120);
  });

  it("عمق الكمرة = الباع الأطول/12، والعرض نص العمق (بحدهما الأدنى)", () => {
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 8, gh: 4 }];
    const est = computeStructuralEstimate(rooms);
    // الباع الأطول 8م = 8000مم/12 = 666.67 → 670
    expect(est.rooms[0].beamDepthMm).toBe(670);
    expect(est.rooms[0].beamWidthMm).toBe(340); // 670/2=335 → تقريب لأعلى 340
  });

  it("غرفة صغيرة جداً: الكمرة ما تنزل تحت الحد الأدنى (250×200مم)", () => {
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 1, gh: 1 }];
    const est = computeStructuralEstimate(rooms);
    expect(est.rooms[0].beamDepthMm).toBe(250);
    expect(est.rooms[0].beamWidthMm).toBe(200);
  });

  it("العمود النموذجي مبني على أكبر غرفة × عدد الطوابق — أكتر طوابق = عمود أكبر", () => {
    const oneFloor = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 6, gh: 6 }];
    const threeFloors = [
      { id: "r1", floor: 0, gx: 0, gy: 0, gw: 6, gh: 6 },
      { id: "r2", floor: 1, gx: 0, gy: 0, gw: 6, gh: 6 },
      { id: "r3", floor: 2, gx: 0, gy: 0, gw: 6, gh: 6 },
    ];
    const est1 = computeStructuralEstimate(oneFloor);
    const est3 = computeStructuralEstimate(threeFloors);
    expect(est3.column.sideMm).toBeGreaterThan(est1.column.sideMm);
    expect(est3.column.floorCount).toBe(3);
  });

  it("العمود مبني على أكبر مساحة غرفة موجودة، مو أول غرفة", () => {
    const rooms = [
      { id: "small", floor: 0, gx: 0, gy: 0, gw: 2, gh: 2 },
      { id: "big", floor: 0, gx: 0, gy: 0, gw: 10, gh: 10 },
    ];
    const est = computeStructuralEstimate(rooms);
    expect(est.column.basedOnAreaM2).toBe(100);
  });

  it("العمود إله حد أدنى معقول حتى لغرفة صغيرة جداً بطابق واحد", () => {
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 1, gh: 1 }];
    const est = computeStructuralEstimate(rooms);
    expect(est.column.sideMm).toBeGreaterThanOrEqual(250);
  });
});
