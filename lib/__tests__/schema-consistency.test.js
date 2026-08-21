// اختبار انحدار (regression) مباشر لصنف الباگ يلي صار فعلياً بـ PR #37: FURNITURE_KINDS
// اتوسّعت بالـ JS بس قيد furniture_kind_check بقاعدة البيانات الحية ضل على القيم القديمة —
// المستخدم واجه خطأ حقيقي بالإنتاج، ومحاكاة Supabase (in-memory، بلا قيود حقيقية) ما كانت
// تقدر تكتشف هالصنف من الأخطاء أصلاً. هاد الاختبار بيقرأ supabase-schema.sql مباشرة (نص خام،
// بلا اتصال بقاعدة بيانات) ويقارن قوائم قيود CHECK فيه بكتالوجات JS المصدر — أي مرة حدا
// يوسّع FURNITURE_KINDS أو MATERIALS بالـ JS وينسى تحديث الـ schema (أو العكس)، هاد
// الاختبار بيفشل فوراً محلياً وبـ CI، قبل ما يوصل للمستخدم.
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { FURNITURE_KINDS } from "../build3d";
import { MATERIALS } from "../materials";
import { ROLE_LABEL } from "../../components/MembersPanel";

// vitest دايماً بيشغّل من جذر المشروع (مكان vitest.config.js) — لا حاجة لـ import.meta.url
const schema = readFileSync(resolve(process.cwd(), "supabase-schema.sql"), "utf8");

function extractTableBlock(tableName) {
  const re = new RegExp(`create table if not exists ${tableName} \\(([\\s\\S]*?)\\n\\);`, "m");
  const match = schema.match(re);
  if (!match) throw new Error(`جدول "${tableName}" مش موجود بـ supabase-schema.sql — تأكد الاسم أو انسخ الملف الحالي`);
  return match[1];
}

function extractCheckValues(block, column) {
  const re = new RegExp(`\\b${column}\\b[^(]*check \\(${column} in \\(([\\s\\S]*?)\\)\\)`, "m");
  const match = block.match(re);
  if (!match) throw new Error(`قيد check(${column} in (...)) مش موجود — تأكد إنه العمود لسا موجود وبنفس الصيغة`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

describe("توافق قيود CHECK بـ supabase-schema.sql مع كتالوجات JS المصدر", () => {
  it("furniture.kind يطابق مفاتيح FURNITURE_KINDS بالضبط (lib/build3d.js)", () => {
    const dbValues = extractCheckValues(extractTableBlock("furniture"), "kind");
    const jsValues = Object.keys(FURNITURE_KINDS).sort();
    expect(dbValues).toEqual(jsValues);
  });

  it("rooms.wall_material يطابق مفاتيح MATERIALS بالضبط (lib/materials.js)", () => {
    const dbValues = extractCheckValues(extractTableBlock("rooms"), "wall_material");
    expect(dbValues).toEqual(Object.keys(MATERIALS).sort());
  });

  it("rooms.floor_material يطابق مفاتيح MATERIALS بالضبط", () => {
    const dbValues = extractCheckValues(extractTableBlock("rooms"), "floor_material");
    expect(dbValues).toEqual(Object.keys(MATERIALS).sort());
  });

  it("projects.wall_material يطابق مفاتيح MATERIALS بالضبط", () => {
    const dbValues = extractCheckValues(extractTableBlock("projects"), "wall_material");
    expect(dbValues).toEqual(Object.keys(MATERIALS).sort());
  });

  it("rooms.roof_type يشمل كل الأنواع المستخدمة فعلياً بالواجهة (flat/gable/hip)", () => {
    const dbValues = extractCheckValues(extractTableBlock("rooms"), "roof_type");
    expect(dbValues).toEqual(["flat", "gable", "hip"].sort());
  });

  it("project_members.role يطابق مفاتيح ROLE_LABEL بالضبط (components/MembersPanel.jsx)", () => {
    const dbValues = extractCheckValues(extractTableBlock("project_members"), "role");
    expect(dbValues).toEqual(Object.keys(ROLE_LABEL).sort());
  });
});
