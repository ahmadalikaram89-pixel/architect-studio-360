// اختبار E2E لحدود الخطأ العامة (app/error.js) — بلا هاد الملف، أي استثناء وقت تشغيل غير
// متوقّع بمكان ما بشجرة React كان بيبيّض الشاشة بالكامل بلا أي رسالة ولا طريقة تعافي.
// بيستخدم app/e2e-harness/crash/page.js يلي بيرمي استثناء حقيقي أثناء الرندر عمداً —
// نفس ملف الإنتاج app/error.js بالضبط بيتفحّص هون، بلا محاكاة أو افتراض.
const { test, expect } = require("@playwright/test");

test("استثناء حقيقي أثناء الرندر بيلتقطه app/error.js بدل ما يبيّض الشاشة", async ({ page }) => {
  await page.goto("/e2e-harness/crash");

  await expect(page.locator("text=صار خطأ غير متوقّع")).toBeVisible();
  await expect(page.locator('button:has-text("حاول من جديد")')).toBeVisible();
  await expect(page.locator('button:has-text("إعادة تحميل الصفحة")')).toBeVisible();
});
