"use client";

// مسار اختبار مخصّص فقط للتحقق من app/error.js (حدود الخطأ العامة) — بيرمي استثناء وقت
// تشغيل حقيقي أثناء الرندر عمداً، بلا أي لمس لكود التطبيق الفعلي (ArchitectStudio.jsx
// وباقي المكوّنات تضل نضيفة، بلا أي منطق اختباري مزروع فيها). آمنة بالإنتاج بنفس أسلوب
// app/e2e-harness/page.js: 404 فعلي لو NODE_ENV=production.
import { notFound } from "next/navigation";

export default function CrashTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  throw new Error("E2E crash test — استثناء متعمّد للتحقق من حدود الخطأ العامة");
}
