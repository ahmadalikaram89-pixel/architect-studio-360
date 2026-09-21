// اختبار E2E دائم لزوم/تحريك المخطط 2D. أهم شي فيه مو أزرار التكبير بحد ذاتها — هو إنه
// **الرسم بيضل يوقع بمكانه الصحيح بالمتر عند أي مستوى زوم**: التحويل من بكسل الشاشة لمتر
// هو نقطة الفشل الوحيدة الحقيقية بهالميزة، وأي انحدار فيه بيخرّب كل تفاعل بالمخطط بصمت
// (غرف بأبعاد غلط، أبواب بمكان غلط) بلا أي رسالة خطأ. يشتغل فوق app/e2e-harness/page.js.
const { test, expect } = require("@playwright/test");

const PPM = 32; // لازم يطابق PPM بـ lib/planGeometry.js

async function newProject(page, name) {
  await page.goto("/e2e-harness");
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', name);
  await page.click('button:has-text("إنشاء المشروع")');
  await page.click('button:has-text("مخطط 2D")');
  await expect(page.locator("canvas").first()).toBeVisible();
}

const zoomLabel = (page) => page.locator("main span.font-mono");
const zoomIn = (page) => page.locator('button[aria-label="تكبير المخطط"]');
const zoomOut = (page) => page.locator('button[aria-label="تصغير المخطط"]');
const zoomFit = (page) => page.locator('button[aria-label="ملاءمة المخطط للشاشة"]');
const canvasCssWidth = (page) =>
  page.locator("canvas").first().evaluate((el) => parseFloat(el.style.width));
const scrollTopOf = (page) => page.locator("main > div.overflow-auto").evaluate((el) => el.scrollTop);

// بتحط مؤشر الفأرة بمنتصف حاوية التمرير المرئية. مهم تكون الإحداثيات منسوبة للحاوية مو
// للكانفاس: بعد التكبير بيصير جزء كبير من الكانفاس (وأحياناً حافته العليا) برّا الشاشة،
// فنقطة "داخل الكانفاس" ممكن تطلع فوق الهيدر أو برّا منفذ العرض كلياً.
async function centerMouseOnPlan(page) {
  const box = await page.locator("main > div.overflow-auto").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  return { x, y };
}

test("أزرار التكبير/التصغير/الملاءمة بتغيّر قياس الكانفاس فعلياً", async ({ page }) => {
  await newProject(page, "مشروع زوم");

  // المخطط الافتراضي (20×15م = 640×480 بكسل) بيدخل كامل بمنفذ 1400×900، فالملاءمة = 100%
  await expect(zoomLabel(page)).toHaveText("100%");
  const baseWidth = await canvasCssWidth(page);
  expect(baseWidth).toBeCloseTo(20 * PPM, 0);

  await zoomIn(page).click();
  await expect(zoomLabel(page)).toHaveText("125%");
  expect(await canvasCssWidth(page)).toBeCloseTo(baseWidth * 1.25, 0);

  await zoomOut(page).click();
  await zoomOut(page).click();
  await expect(zoomLabel(page)).toHaveText("80%");
  expect(await canvasCssWidth(page)).toBeCloseTo(baseWidth * 0.8, 0);

  await zoomFit(page).click();
  await expect(zoomLabel(page)).toHaveText("100%");
  expect(await canvasCssWidth(page)).toBeCloseTo(baseWidth, 0);
});

test("الرسم بيوقع بالمتر الصحيح عند زوم غير 100% (حارس انحدار تحويل الإحداثيات)", async ({ page }) => {
  await newProject(page, "مشروع دقة الزوم");

  // زوم 156.25% → كل متر = 50 بكسل على الشاشة
  await zoomIn(page).click();
  await zoomIn(page).click();
  await expect(zoomLabel(page)).toHaveText("156%");
  const pxPerMeter = PPM * 1.25 * 1.25;
  expect(pxPerMeter).toBe(50);

  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(box.x + 2 * pxPerMeter, box.y + 2 * pxPerMeter);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 * pxPerMeter, box.y + 5 * pxPerMeter, { steps: 5 });
  await page.mouse.up();

  // 4م × 3م = 12 م². لو التحويل تجاهل الزوم كان رح تطلع الغرفة ~6.5×4.5 (29 م²)
  await expect(page.locator("aside p").filter({ hasText: "م²" }).first()).toHaveText("12.0 م²");
});

test("Ctrl + عجلة الفأرة بتكبّر المخطط، والعجلة لحالها بتحرّكه بلا تكبير", async ({ page }) => {
  await newProject(page, "مشروع عجلة");
  for (let i = 0; i < 4; i++) await zoomIn(page).click(); // 244% — المخطط أكبر من الحاوية فصار في تمرير فعلي
  const zoomed = await canvasCssWidth(page);

  await centerMouseOnPlan(page);

  // عجلة عادية = تحريك (تمرير الحاوية)، بلا أي تغيير بالزوم
  const scrollBefore = await scrollTopOf(page);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  expect(await canvasCssWidth(page)).toBeCloseTo(zoomed, 0);
  expect(await scrollTopOf(page)).toBeGreaterThan(scrollBefore);

  // Ctrl + عجلة = تكبير
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  expect(await canvasCssWidth(page)).toBeGreaterThan(zoomed);
});

test("اختصارات لوحة المفاتيح + / − / 0", async ({ page }) => {
  await newProject(page, "مشروع اختصارات");
  await page.keyboard.press("+");
  await expect(zoomLabel(page)).toHaveText("125%");
  await page.keyboard.press("-");
  await expect(zoomLabel(page)).toHaveText("100%");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await expect(zoomLabel(page)).toHaveText("156%");
  await page.keyboard.press("0");
  await expect(zoomLabel(page)).toHaveText("100%");
});

test("الزر الأوسط للفأرة بيحرّك المخطط بلا ما يرسم غرفة", async ({ page }) => {
  await newProject(page, "مشروع تحريك");
  for (let i = 0; i < 4; i++) await zoomIn(page).click(); // 244% — أكبر من الحاوية

  const { x, y } = await centerMouseOnPlan(page);
  const before = await scrollTopOf(page);

  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x, y - 120, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(150);

  expect(await scrollTopOf(page)).toBeGreaterThan(before);
  await expect(page.locator("aside select")).toHaveCount(0); // ما انرسمت ولا غرفة
});

test.describe("لمس", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("قرصة بإصبعين بتكبّر المخطط بلا ما ترسم غرفة", async ({ page }) => {
    await newProject(page, "مشروع قرصة");
    const start = await zoomLabel(page).textContent();

    const box = await page.locator("canvas").first().boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // أحداث لمس حقيقية عبر CDP — page.touchscreen بتدعم النقر بس، مو إصبعين
    const client = await page.context().newCDPSession(page);
    const send = (type, touchPoints) => client.send("Input.dispatchTouchEvent", { type, touchPoints });

    await send("touchStart", [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
    for (const spread of [70, 110, 150]) {
      await send("touchMove", [{ x: cx - spread, y: cy, id: 1 }, { x: cx + spread, y: cy, id: 2 }]);
      await page.waitForTimeout(40);
    }
    await send("touchEnd", []);
    await page.waitForTimeout(200);

    const end = await zoomLabel(page).textContent();
    expect(parseInt(end, 10)).toBeGreaterThan(parseInt(start, 10));
    await expect(page.locator("aside select")).toHaveCount(0); // القرصة ما بترسم غرفة
  });
});
