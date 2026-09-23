// اختبار E2E دائم لعرض "بيت الدمية" — المبنى بلا أسقف، بطوابق مفكوكة، بكاميرا مرتفعة
// بتشوف جوا كل الغرف دفعة وحدة.
//
// التحقق الجوهري هون بصري بطبيعته (مشهد WebGL — ما بينقرأ من DOM)، فبينقاس **بقياس فعلي
// على البكسل**: أرضيات الغرف ملوّنة ومشبّعة، بينما السقف والجدران والخلفية كلها رمادية
// شبه عديمة التشبّع. فنسبة البكسلات المشبّعة = مقياس مباشر لـ"قدّيش شايف جوا الغرف".
// اللقطة بتنقرأ عبر <img> + كانفاس ثنائي الأبعاد بالصفحة نفسها (كانفاس WebGL ما بينقرأ
// مباشرة بلا preserveDrawingBuffer، ومش مضبوط نغيّر إعداد إنتاجي لأجل اختبار).
const { test, expect } = require("@playwright/test");

const PPM = 32;

async function newProject(page, name) {
  await page.goto("/e2e-harness");
  await page.fill('input[placeholder="مثال: فيلا العائلة"]', name);
  await page.click('button:has-text("إنشاء المشروع")');
  await page.click('button:has-text("مخطط 2D")');
  await expect(page.locator("canvas").first()).toBeVisible();
}

async function drawRoom(page, x1, y1, x2, y2) {
  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(box.x + x1 * PPM, box.y + y1 * PPM);
  await page.mouse.down();
  await page.mouse.move(box.x + x2 * PPM, box.y + y2 * PPM, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

// نسبة بكسلات المشهد يلي إلها لون مشبّع فعلاً (أرضيات الغرف) من أصل كل البكسلات
async function saturatedFraction(page) {
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let saturated = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 0 && (max - min) / max > 0.18) saturated++;
    }
    return saturated / total;
  }, `data:image/png;base64,${png.toString("base64")}`);
}

// نسبة بكسلات بدرجة لون (hue) قريبة من درجة معيّنة — أدق من التشبّع العام لما بدنا نتأكد
// إنه **أرضية طابق بعينه** صارت مرئية. الدرجة (hue) بتصمد قدّام الإضاءة والظل والنسيج،
// بعكس مطابقة قيمة RGB الخام يلي بتفشل مع أول مصدر ضوء
async function hueFraction(page, targetHue, tolerance = 22) {
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async ({ dataUrl, targetHue, tolerance }) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let hits = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (max <= 0 || d / max <= 0.18) continue; // رمادي (جدار/سقف/خلفية)
      let h;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      const diff = Math.min(Math.abs(h - targetHue), 360 - Math.abs(h - targetHue));
      if (diff <= tolerance) hits++;
    }
    return hits / total;
  }, { dataUrl: `data:image/png;base64,${png.toString("base64")}`, targetHue, tolerance });
}

const HUE_TERRACOTTA = 18;  // طوبي #C7714E — اللون الافتراضي
const HUE_SAGE = 137;       // أخضر مريمية #5FBF7A

test("غرفة مسقوفة: بعرض 3D مغطّاة، وببيت الدمية بتنفتح على جوّاتها", async ({ page }) => {
  await newProject(page, "بيت الدمية — سقف");
  await drawRoom(page, 3, 3, 13, 11);

  await page.click('button:has-text("عرض 3D · 360°")');
  // تحديد الغرفة من القائمة الجانبية عبر نقطة لونها — النقر على صف الغرفة نفسه بيصادف
  // قائمة <select> اسم الغرفة وبيفتحها (قائمة أصلية بتجمّد باقي التفاعل بالاختبار)
  await page.locator("aside div.cursor-pointer span.rounded-full").first().click();
  const roofBtn = page.locator('button:has-text("إضافة سطح للغرفة")');
  await expect(roofBtn).toBeVisible();
  await roofBtn.click();
  await page.waitForTimeout(1600);
  const roofedFraction = await saturatedFraction(page);

  await page.click('button:has-text("بيت الدمية")');
  await page.waitForTimeout(1800);
  const dollhouseFraction = await saturatedFraction(page);

  // السقف الرمادي بيخفي أرضية الغرفة الملوّنة كلياً؛ بيت الدمية بيرجّعها للظهور
  expect(dollhouseFraction).toBeGreaterThan(0.02);
  expect(dollhouseFraction).toBeGreaterThan(roofedFraction * 3);
});

test("مبنى بطابقين: فكّ الطوابق بيظهر أرضية الطابق الأرضي يلي كانت محجوبة تماماً", async ({ page }) => {
  await newProject(page, "بيت الدمية — طابقين");
  // طابق أرضي بلون طوبي (الافتراضي)، وطابق أول بلون أخضر مريمية — لونان بعيدان عن بعض
  // بدرجة اللون، فوجود كل وحدة بالمشهد بينقاس لحاله بلا أي التباس
  await drawRoom(page, 2, 2, 12, 10);
  await page.click('button[title="إضافة طابق"]');
  await page.waitForTimeout(300);
  await page.click('button[title="أخضر مريمية"]');
  await drawRoom(page, 2, 2, 12, 10);

  await page.click('button:has-text("بيت الدمية")');
  await page.waitForTimeout(1800);

  const slider = page.locator("#floor-gap");
  await expect(slider).toBeVisible(); // الشريط بيظهر بس لما يصير أكتر من طابق
  await slider.fill("0");
  await page.waitForTimeout(1500);
  const stackedGreen = await hueFraction(page, HUE_SAGE);
  const stackedTerracotta = await hueFraction(page, HUE_TERRACOTTA);

  // طوابق ملتصقة: أرضية الطابق الأول (خضرا) واضحة، وأرضية الأرضي (طوبي) محجوبة تماماً
  // خلفها — القياس الفعلي هون بيطلع **صفر بكسل** بالضبط، مو "قليل"
  expect(stackedGreen).toBeGreaterThan(0.02);
  expect(stackedTerracotta).toBeLessThan(0.0005);

  await slider.fill("5");
  await page.waitForTimeout(1500);
  const spreadTerracotta = await hueFraction(page, HUE_TERRACOTTA);

  // بعد الفكّ: أرضية الطابق الأرضي صارت مرئية فعلاً (القياس ~0.009 — العتبة مضبوطة
  // تحتها بهامش، لأن الكاميرا بتتراجع لورا مع التباعد فحصة المبنى من الكادر بتصغر)
  expect(spreadTerracotta).toBeGreaterThan(0.004);
});

test("تبويب بيت الدمية معطّل قبل رسم أي غرفة، وشريط التباعد مخفي بطابق واحد", async ({ page }) => {
  await newProject(page, "بيت الدمية — حالات");
  const tab = page.locator('button:has-text("بيت الدمية")');
  await expect(tab).toBeDisabled();

  await drawRoom(page, 3, 3, 9, 8);
  await expect(tab).toBeEnabled();

  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await tab.click();
  await page.waitForTimeout(1200);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#floor-gap")).toHaveCount(0);
  await expect(page.locator("text=تباعد الطوابق بيظهر هون")).toBeVisible();
  expect(consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_RESET") && !e.includes("ERR_CERT"))).toEqual([]);
});
