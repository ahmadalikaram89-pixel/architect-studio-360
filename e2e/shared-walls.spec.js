// اختبار E2E دائم لدمج الجدران المشتركة للغرف الحرة الشكل. التحقق الحاسم هون مو بصري —
// هو **طول الجدران الصافي بجدول الكميات**: رقم بيشوفه المستخدم ويبني عليه تكلفة، وبيفضح
// فوراً إذا الجدار المشترك انحسب مرتين (أو انخصم مرتين بالغلط). يشتغل فوق
// app/e2e-harness/page.js نفسه المستخدَم بباقي اختبارات E2E.
const { test, expect } = require("@playwright/test");

const PPM = 32; // لازم يطابق PPM بـ lib/planGeometry.js

async function newProject(page, name) {
  await page.goto("/e2e-harness");
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', name);
  await page.click('button:has-text("إنشاء المشروع")');
  await page.click('button:has-text("مخطط 2D")');
  await expect(page.locator("canvas").first()).toBeVisible();
}

// يرسم غرفة حرة الشكل بنقاط بالمتر (بيسكّر المضلع بالرجوع لأول نقطة)
async function drawPolygon(page, meterPoints) {
  await page.click('button:has-text("ارسم شكل حر")');
  const box = await page.locator("canvas").first().boundingBox();
  const click = async ([mx, my]) => {
    await page.mouse.click(box.x + mx * PPM, box.y + my * PPM);
    await page.waitForTimeout(60);
  };
  for (const p of meterPoints) await click(p);
  await click(meterPoints[0]);
  await page.waitForTimeout(400);
}

// قراءة بند رقمي من جدول الكميات (بيفتح اللوحة وبيسكّرها)
async function boqRow(page, label) {
  await page.click('button:has-text("جدول الكميات")');
  const row = page.locator("tr", { hasText: label }).first();
  await expect(row).toBeVisible();
  const text = await row.innerText();
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });
  return text;
}

async function boqCount(page, label) {
  const m = (await boqRow(page, label)).match(/(\d+)/);
  return parseInt(m[1], 10);
}

async function boqWallLength(page) {
  await page.click('button:has-text("جدول الكميات")');
  const row = page.locator("tr", { hasText: "طول الجدران" }).first();
  await expect(row).toBeVisible();
  const text = await row.innerText();
  await page.locator("div.fixed.inset-0.z-50").first().click({ position: { x: 10, y: 150 } });
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return parseFloat(m[1]);
}

test("غرفتان حرتان متلاصقتان: الجدار المشترك بينحسب مرة وحدة بطول الجدران الصافي", async ({ page }) => {
  await newProject(page, "جدران مشتركة حرة");

  // مربع حر 4×4 — محيطه 16م
  await drawPolygon(page, [[2, 2], [6, 2], [6, 6], [2, 6]]);
  expect(await boqWallLength(page)).toBeCloseTo(16, 1);

  // مربع حر تاني ملاصق له تماماً على الضلع x=6 (طول التلامس 4م)
  await drawPolygon(page, [[6, 2], [10, 2], [10, 6], [6, 6]]);
  await expect(page.locator("aside select")).toHaveCount(2);

  // 16 + 16 − 4 = 28. بلا دمج كان رح يطلع 32
  expect(await boqWallLength(page)).toBeCloseTo(28, 1);
});

test("غرفة حرة ملاصقة لغرفة مستطيلة — نفس الدمج", async ({ page }) => {
  await newProject(page, "حر وملاصق مستطيل");

  // مستطيل 4×4 بالسحب من (6,2) لـ(10,6) — محيطه 16م
  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(box.x + 6 * PPM, box.y + 2 * PPM);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 * PPM, box.y + 6 * PPM, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await boqWallLength(page)).toBeCloseTo(16, 1);

  await drawPolygon(page, [[2, 2], [6, 2], [6, 6], [2, 6]]);
  await expect(page.locator("aside select")).toHaveCount(2);
  expect(await boqWallLength(page)).toBeCloseTo(28, 1);
});

test("غرفتان حرتان مو متلاصقتين — بلا أي دمج", async ({ page }) => {
  await newProject(page, "حرتان متباعدتان");
  await drawPolygon(page, [[1, 2], [5, 2], [5, 6], [1, 6]]);
  await drawPolygon(page, [[9, 2], [13, 2], [13, 6], [9, 6]]);
  await expect(page.locator("aside select")).toHaveCount(2);
  expect(await boqWallLength(page)).toBeCloseTo(32, 1);
});

test("ما بينفع تنحط نافذة على جدار مشترك بين غرفتين حرتين، والباب بينفع", async ({ page }) => {
  await newProject(page, "نافذة على مشترك");
  await drawPolygon(page, [[2, 2], [6, 2], [6, 6], [2, 6]]);
  await drawPolygon(page, [[6, 2], [10, 2], [10, 6], [6, 6]]);

  const box = await page.locator("canvas").first().boundingBox();
  const onSharedWall = { x: box.x + 6 * PPM, y: box.y + 4 * PPM };

  // نافذة على الجدار المشترك: مرفوضة (بتطل على غرفة تانية — نفس قاعدة الجدران المستطيلة).
  // وللتأكد إنه الرفض سببه "مشترك" مو "النقر ما التقط أي جدار": نفس الأداة بتنجح فوراً
  // على جدار خارجي من نفس الغرفة.
  await page.click('button:has-text("نافذة")');
  await page.mouse.click(onSharedWall.x, onSharedWall.y);
  await page.waitForTimeout(400);
  expect(await boqCount(page, "عدد النوافذ")).toBe(0);

  await page.mouse.click(box.x + 4 * PPM, box.y + 2 * PPM); // جدار خارجي (y=2)
  await page.waitForTimeout(400);
  expect(await boqCount(page, "عدد النوافذ")).toBe(1);
  await page.click('button:has-text("نافذة")'); // إطفاء الوضع

  // باب على نفس المكان: مقبول
  await page.click('button:has-text("باب")');
  await page.mouse.click(onSharedWall.x, onSharedWall.y);
  await page.waitForTimeout(500);
  await page.click('button:has-text("باب")');
  expect(await boqCount(page, "عدد الأبواب")).toBe(1);

  // عرض 3D بيترندر الجدار المشترك (بفتحة الباب) بلا كراش
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.click('button:has-text("عرض 3D · 360°")');
  await page.waitForTimeout(900);
  expect(consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_RESET") && !e.includes("ERR_CERT"))).toEqual([]);
});
