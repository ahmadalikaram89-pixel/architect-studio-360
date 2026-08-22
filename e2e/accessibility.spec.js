// اختبار E2E لإتاحة الوصول (accessibility) — تدقيق آلي حقيقي بـ @axe-core/playwright على
// شاشات الواجهة الرئيسية (إعداد المشروع، المراحل، المخطط 2D، جدول الكميات، التقدير
// الإنشائي، أعضاء المشروع، عرض 3D). هدفه يمسك انحدارات إتاحة وصول (تباين ألوان، أزرار/قوائم
// بلا اسم وصولي، حقول بلا تسمية...) تلقائياً بدل الاعتماد على تدقيق يدوي متكرر. يشتغل فوق
// app/e2e-harness/page.js نفسه المستخدَم بباقي اختبارات E2E — بلا قاعدة بيانات حقيقية.
// شريط تبديل المستخدم بالتطوير (e2e-user-switcher) مستثنى لأنه أداة اختبار داخلية مو جزء
// من واجهة الإنتاج الفعلية. الكانفاس ثنائي/ثلاثي الأبعاد نفسه خارج نطاق هالتدقيق عمداً —
// عنصر بصري بحت متل أي أداة CAD تقليدية، بلا محتوى نصي/تفاعلي قابل للوصول عبر قارئ شاشة.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright");

function scan(page) {
  return new AxeBuilder({ page }).exclude('[data-testid="e2e-user-switcher"]').analyze();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-harness");
});

test("لا مخالفات إتاحة وصول عبر شاشات الواجهة الرئيسية", async ({ page }) => {
  test.setTimeout(90_000); // سبع عمليات تدقيق axe متتالية بتفس الاختبار — أبطأ من حد الـ30 ثانية الافتراضي
  let results = await scan(page);
  expect(results.violations, "ProjectSetup").toEqual([]);

  await page.fill('input[placeholder="مثال: فيلا العائلة"]', "اختبار إتاحة الوصول");
  await page.click('button:has-text("إنشاء المشروع")');
  await expect(page.locator('h1:has-text("اختبار إتاحة الوصول")')).toBeVisible();
  results = await scan(page);
  expect(results.violations, "PhaseTracker").toEqual([]);

  await page.click('button:has-text("مخطط 2D")');
  await page.click('button:has-text("نموذج جاهز")');
  await page.waitForTimeout(300);
  results = await scan(page);
  expect(results.violations, "Plan2D").toEqual([]);

  await page.click('button:has-text("جدول الكميات")');
  await expect(page.locator("text=مساحة البناء الإجمالية")).toBeVisible();
  results = await scan(page);
  expect(results.violations, "BoqPanel").toEqual([]);
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  await page.click('button:has-text("تقدير إنشائي")');
  await expect(page.locator("text=هاد مو تصميم إنشائي معتمد")).toBeVisible();
  results = await scan(page);
  expect(results.violations, "StructuralPanel").toEqual([]);
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  await page.click('button:has-text("أعضاء المشروع")');
  await expect(page.locator("text=دعوة بالإيميل مباشرة")).toBeVisible();
  results = await scan(page);
  expect(results.violations, "MembersPanel").toEqual([]);
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  await page.click('button:has-text("عرض 3D · 360°")');
  await page.waitForTimeout(400);
  await expect(page.locator("canvas")).toBeVisible();
  results = await scan(page);
  expect(results.violations, "Viewport3D").toEqual([]);
});
