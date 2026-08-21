// اختبار حقيقي — بيفسّر ملف IFC المولَّد فعلياً عبر web-ifc (نفس محرّك التفسير يلي بيستخدمه
// IFC.js/That Open Company)، مو بس فحص نص/regex. أي خطأ صياغة STEP (فاصلة منقوطة ناقصة،
// entity id غلط، enum غير صحيح...) بيفشل هون فوراً — نفس الروح يلي خلّت هالجلسة تبني
// schema-consistency.test.js: تحقّق حقيقي بأداة خارجية، مو افتراض إنه النص "شكله صحيح"
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IfcAPI, IFCPROJECT, IFCBUILDINGSTOREY, IFCWALL, IFCSLAB, IFCDOOR, IFCWINDOW, IFCSTAIR } from "web-ifc";
import { exportProjectToIfc } from "../ifcExport";

let ifcApi;

beforeAll(async () => {
  ifcApi = new IfcAPI();
  await ifcApi.Init();
});

function parseIfc(ifcText) {
  const modelID = ifcApi.OpenModel(new TextEncoder().encode(ifcText));
  return modelID;
}

function countType(modelID, type) {
  return ifcApi.GetLineIDsWithType(modelID, type).size();
}

describe("exportProjectToIfc", () => {
  it("مشروع بسيط: غرفة وحيدة بطابق واحد — ملف صالح فعلاً بمحرّك تفسير IFC حقيقي", () => {
    const project = { name: "مشروع بسيط", wall_height: 2.7 };
    const rooms = [{ id: "r1", floor: 0, gx: 0, gy: 0, gw: 4, gh: 3, has_roof: true, openings: [] }];
    const ifcText = exportProjectToIfc(project, rooms, []);

    expect(ifcText.startsWith("ISO-10303-21;")).toBe(true);
    expect(ifcText.trim().endsWith("END-ISO-10303-21;")).toBe(true);

    const modelID = parseIfc(ifcText);
    expect(countType(modelID, IFCPROJECT)).toBe(1);
    expect(countType(modelID, IFCBUILDINGSTOREY)).toBe(1);
    expect(countType(modelID, IFCWALL)).toBe(4); // أربعة أضلاع، بلا فتحات = عمود واحد لكل ضلع
    expect(countType(modelID, IFCSLAB)).toBe(2); // أرضية + سقف (has_roof)
    ifcApi.CloseModel(modelID);
  });

  it("فتحة باب على ضلع: بتولّد IFCDOOR + عتبة تحت/فوق الفتحة (جدارين إضافيين على نفس الضلع)", () => {
    const project = { name: "بيت بباب", wall_height: 2.7 };
    const rooms = [{
      id: "r1", floor: 0, gx: 0, gy: 0, gw: 4, gh: 3, has_roof: false,
      openings: [{ wall: "bottom", kind: "door", position: 2 }],
    }];
    const ifcText = exportProjectToIfc(project, rooms, []);
    const modelID = parseIfc(ifcText);

    expect(countType(modelID, IFCDOOR)).toBe(1);
    // الضلع اللي فيه الباب صار جدارين (يمين ويسار الباب) بدل واحد، والعتبة العلوية فوق الباب
    // (سقف الباب 2.05م أقل من ارتفاع الجدار 2.7م) — 3 أضلاع بلا فتحة (عمود واحد لكل وحدة) + الضلع الرابع (2 عمود + عتبة فوق)
    expect(countType(modelID, IFCWALL)).toBe(3 + 2 + 1);
    ifcApi.CloseModel(modelID);
  });

  it("فتحة نافذة: بتولّد IFCWINDOW + عتبة تحت وفوق الفتحة (النافذة ما توصل للأرض)", () => {
    const project = { name: "بيت بنافذة", wall_height: 2.7 };
    const rooms = [{
      id: "r1", floor: 0, gx: 0, gy: 0, gw: 4, gh: 3, has_roof: false,
      openings: [{ wall: "top", kind: "window", position: 2 }],
    }];
    const ifcText = exportProjectToIfc(project, rooms, []);
    const modelID = parseIfc(ifcText);

    expect(countType(modelID, IFCWINDOW)).toBe(1);
    // النافذة إلها sill>0 وopenH<wallHeight، فبتضيف عتبتين (تحت وفوق) بدل وحدة بس
    expect(countType(modelID, IFCWALL)).toBe(3 + 2 + 2);
    ifcApi.CloseModel(modelID);
  });

  it("غرفة حرة الشكل (مثلث): جدار لكل ضلع، بلا انهيار", () => {
    const project = { name: "غرفة مثلثة", wall_height: 2.7 };
    const rooms = [{
      id: "r1", floor: 0, gx: 0, gy: 0, gw: 6, gh: 4, has_roof: true,
      points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 4 }],
      openings: [],
    }];
    const ifcText = exportProjectToIfc(project, rooms, []);
    const modelID = parseIfc(ifcText);

    expect(countType(modelID, IFCWALL)).toBe(3);
    expect(countType(modelID, IFCSLAB)).toBe(2);
    ifcApi.CloseModel(modelID);
  });

  it("سلم بين طابقين: بيولّد IFCSTAIR واحد بهندسة صالحة", () => {
    const project = { name: "بيت بسلم", wall_height: 2.7 };
    const rooms = [
      { id: "r1", floor: 0, gx: 0, gy: 0, gw: 6, gh: 6, has_roof: false, openings: [] },
      { id: "r2", floor: 1, gx: 0, gy: 0, gw: 6, gh: 6, has_roof: true, openings: [] },
    ];
    const stairs = [{ id: "s1", floor: 0, x: 4, y: 4, rotation: 0 }];
    const ifcText = exportProjectToIfc(project, rooms, stairs);
    const modelID = parseIfc(ifcText);

    expect(countType(modelID, IFCSTAIR)).toBe(1);
    expect(countType(modelID, IFCBUILDINGSTOREY)).toBe(2);
    ifcApi.CloseModel(modelID);
  });

  it("طوابق متعددة: ارتفاع كل طابق يزيد تراكمياً (نفس computeFloorBaseYMap)", () => {
    const project = { name: "بيت طابقين", wall_height: 3 };
    const rooms = [
      { id: "r1", floor: 0, gx: 0, gy: 0, gw: 4, gh: 4, has_roof: false, openings: [] },
      { id: "r2", floor: 1, gx: 0, gy: 0, gw: 4, gh: 4, has_roof: true, openings: [] },
    ];
    const ifcText = exportProjectToIfc(project, rooms, []);
    const modelID = parseIfc(ifcText);

    const storeyIds = ifcApi.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
    const elevations = [];
    for (let i = 0; i < storeyIds.size(); i++) {
      elevations.push(ifcApi.GetLine(modelID, storeyIds.get(i)).Elevation.value);
    }
    elevations.sort((a, b) => a - b);
    expect(elevations[0]).toBe(0);
    expect(elevations[1]).toBeGreaterThan(3); // 3 + سماكة السقف
    ifcApi.CloseModel(modelID);
  });

  it("مشروع فاضي (بلا غرف): بيصدّر هيكل مبنى صالح بلا انهيار", () => {
    const ifcText = exportProjectToIfc({ name: "فاضي", wall_height: 2.7 }, [], []);
    const modelID = parseIfc(ifcText);
    expect(countType(modelID, IFCPROJECT)).toBe(1);
    expect(countType(modelID, IFCWALL)).toBe(0);
    ifcApi.CloseModel(modelID);
  });

  it("اسم مشروع بالعربي: بيتحفظ ويترجع صح بلا تلف بالترميز", () => {
    const project = { name: "فيلا العائلة الجميلة", wall_height: 2.7 };
    const ifcText = exportProjectToIfc(project, [], []);
    const modelID = parseIfc(ifcText);
    const projectIds = ifcApi.GetLineIDsWithType(modelID, IFCPROJECT);
    const line = ifcApi.GetLine(modelID, projectIds.get(0));
    expect(line.Name.value).toBe("فيلا العائلة الجميلة");
    ifcApi.CloseModel(modelID);
  });
});
