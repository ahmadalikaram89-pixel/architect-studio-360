// اختبار E2E لميزة "أعضاء فريق بصلاحيات" — يحاكي ثلاث جلسات (مالك/محرّر/مُشاهد) بنفس
// تحميل الصفحة عبر مبدّل المستخدم بأعلى app/e2e-harness/page.js، بلا حاجة لقاعدة بيانات
// حقيقية أو Supabase فعلي. نفس السيناريو يلي اتحقّق منه يدوياً بالمتصفح وقت بناء الميزة،
// بس صار دائم وبيشتغل تلقائياً بكل push/PR من هلق.
const { test, expect } = require("@playwright/test");

test("دعوة محرّر ومُشاهد: كل واحد بياخد الصلاحية الصحيحة تلقائياً بعد إعادة التحميل", async ({ page }) => {
  await page.goto("/e2e-harness");

  // كمالك: مشروع، غرف، دعوتان
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', "مشروع تعاوني E2E");
  await page.click('button:has-text("إنشاء المشروع")');
  await page.click('button:has-text("مخطط 2D")');
  await page.click('button:has-text("نموذج جاهز")');

  await page.click('button:has-text("أعضاء المشروع")');
  await page.fill('input[type="email"]', "editor@e2e.local");
  await page.click('button:has-text("دعوة")');
  await page.fill('input[type="email"]', "viewer@e2e.local");
  await page.selectOption('form select', "viewer");
  await page.click('button:has-text("دعوة")');
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });

  // المحرّر: يشوف المشروع تلقائياً، بلا بانر قراءة فقط، ويقدر يعدّل
  await page.click('[data-testid="switch-editor"]');
  await expect(page.locator('h1:has-text("مشروع تعاوني E2E")')).toBeVisible();
  await expect(page.locator("text=وضع العرض فقط")).toHaveCount(0);
  await page.click('button:has-text("مخطط 2D")');
  const canvas = page.locator("canvas").first();
  const roomCountBeforeEdit = await page.locator("aside select").count();
  const editorBox = await canvas.boundingBox();
  await page.mouse.move(editorBox.x + 400, editorBox.y + 400);
  await page.mouse.down();
  await page.mouse.move(editorBox.x + 550, editorBox.y + 500, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("aside select")).toHaveCount(roomCountBeforeEdit + 1);
  const editorRoomNames = await page.locator("aside select").evaluateAll((els) => els.map((el) => el.value));
  expect(editorRoomNames).toContain("غرفة نوم");

  // المُشاهد: يشوف المشروع وبانر القراءة فقط، وما يقدر يرسم غرفة جديدة
  await page.click('[data-testid="switch-viewer"]');
  await expect(page.locator('h1:has-text("مشروع تعاوني E2E")')).toBeVisible();
  await expect(page.locator("text=وضع العرض فقط")).toBeVisible();
  await page.click('button:has-text("مخطط 2D")');
  const roomCountBefore = await page.locator("aside select").count();
  const viewerBox = await canvas.boundingBox();
  await page.mouse.move(viewerBox.x + 100, viewerBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(viewerBox.x + 250, viewerBox.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const roomCountAfter = await page.locator("aside select").count();
  expect(roomCountAfter).toBe(roomCountBefore);
});
