// اختبار E2E دائم لدعم الموبايل/الشاشات الصغيرة — منفذ عرض هاتف حقيقي (iPhone 13) بدل
// Desktop Chrome الافتراضي. يتأكد إنه: (1) الهيدر ما بيفيض أفقياً بعد تجميع الأزرار
// الثانوية بقائمة "المزيد"، (2) القائمة الجانبية بتفتح/تسكر كـ drawer عبر زر الهمبرغر،
// (3) قائمة "المزيد" بتفتح/تسكر، (4) الرسم باللمس/الفأرة على الكانفاس ضل شغال، (5) عرض
// 3D بيترندر بلا مشاكل. يشتغل فوق app/e2e-harness/page.js نفسه المستخدَم بباقي اختبارات E2E.
const { test, expect } = require("@playwright/test");

// إعداد منفذ عرض هاتف يدوياً (بدل devices["iPhone 13"]) — بعض device presets بمكتبة
// Playwright بتحمل defaultBrowserType: "webkit" ضمنياً، يلي بيتعارض مع تثبيت executablePath
// الكروميوم المخصّص بـ playwright.config.js (بيئة sandbox هون بلا WebKit مثبّت)
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-harness");
});

test("الهيدر والقائمة الجانبية بيشتغلوا صح على منفذ عرض هاتف", async ({ page }) => {
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', "مشروع اختبار موبايل");
  await page.click('button:has-text("إنشاء المشروع")');
  await expect(page.locator('h1:has-text("مشروع اختبار موبايل")')).toBeVisible();

  // الهيدر ما بيفيض أفقياً (بعد تجميع الأزرار الثانوية بقائمة "المزيد")
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowX).toBeLessThanOrEqual(1);

  await page.click('button:has-text("مخطط 2D")');
  await page.waitForTimeout(300);

  // القائمة الجانبية مخفية افتراضياً على الهاتف، وبتفتح/تسكر عبر زر الهمبرغر
  const sidebarToggle = page.locator('button[aria-label="فتح/إغلاق القائمة الجانبية"]');
  await expect(sidebarToggle).toBeVisible();
  await expect(page.locator("text=الطوابق")).toBeHidden();
  await sidebarToggle.click();
  await expect(page.locator("text=الطوابق")).toBeVisible();
  await sidebarToggle.click();
  await expect(page.locator("text=الطوابق")).toBeHidden();

  // قائمة "المزيد" بتجمع الأزرار الثانوية (تصدير/BOQ/تقدير إنشائي/أعضاء...) وبتفتح/تسكر
  const moreToggle = page.locator('button[aria-label="المزيد من الإجراءات"]');
  await expect(moreToggle).toBeVisible();
  await expect(page.locator('button:has-text("جدول الكميات")')).toBeHidden();
  await moreToggle.click();
  await expect(page.locator('button:has-text("جدول الكميات")')).toBeVisible();

  // رسم غرفة بالسحب على الكانفاس ضل شغال على منفذ عرض هاتف
  await moreToggle.click(); // إغلاق القائمة قبل الرسم
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 140, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await sidebarToggle.click();
  await expect(page.locator("aside select").first()).toBeVisible();
  await sidebarToggle.click();

  // عرض 3D بيترندر بلا كراش على منفذ عرض هاتف
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.click('button:has-text("عرض 3D · 360°")');
  await page.waitForTimeout(600);
  await expect(page.locator("canvas")).toBeVisible();
  expect(consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_RESET"))).toEqual([]);
});
