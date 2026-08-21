// اختبار E2E للمسار الذهبي — إنشاء مشروع، رسم غرف، فتح لوحات جدول الكميات والتقدير
// الإنشائي، والتبديل لعرض 3D. هدفه يمسك انحدارات بصرية/تفاعلية ما بتقدر اختبارات vitest
// الصرفة تكتشفها (كلها بتختبر دوال منفصلة، مو تفاعل حقيقي بالواجهة). يشتغل فوق صفحة
// app/e2e-harness/page.js يلي بتحاكي Supabase بالذاكرة، بلا قاعدة بيانات حقيقية.
const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-harness");
});

test("إنشاء مشروع، تحميل نموذج جاهز، وفتح جدول الكميات والتقدير الإنشائي", async ({ page }) => {
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', "مشروع اختبار E2E");
  await page.click('button:has-text("إنشاء المشروع")');
  await expect(page.locator('h1:has-text("مشروع اختبار E2E")')).toBeVisible();

  await page.click('button:has-text("مخطط 2D")');
  await page.click('button:has-text("نموذج جاهز")');
  const roomNames = await page.locator("aside select").evaluateAll((els) => els.map((el) => el.value));
  expect(roomNames).toContain("صالة");
  expect(roomNames).toContain("مطبخ");

  // جدول الكميات — يحتوي بنود الخرسانة/الحديد المشتقة من التقدير الإنشائي
  await page.click('button:has-text("جدول الكميات")');
  await expect(page.locator("text=مساحة البناء الإجمالية")).toBeVisible();
  await expect(page.locator("text=خرسانة البلاطات")).toBeVisible();
  await expect(page.locator("text=حديد تسليح تقديري")).toBeVisible();
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  // التقدير الإنشائي — تحذير السلامة ظاهر دايماً
  await page.click('button:has-text("تقدير إنشائي")');
  await expect(page.locator("text=هاد مو تصميم إنشائي معتمد")).toBeVisible();
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  // عرض 3D — لازم يفتح بلا كراش (فحص عدم-رجوع على مسار الرندر ثلاثي الأبعاد)
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.click('button:has-text("عرض 3D · 360°")');
  await page.waitForTimeout(600);
  await expect(page.locator("canvas")).toBeVisible();
  expect(consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_RESET"))).toEqual([]);
});

test("رسم غرفة يدوياً بالسحب على الكانفاس بينضاف للقائمة الجانبية", async ({ page }) => {
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', "مشروع رسم يدوي");
  await page.click('button:has-text("إنشاء المشروع")');
  await page.click('button:has-text("مخطط 2D")');

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await expect(page.locator("aside select").first()).toHaveValue("غرفة نوم");
});
