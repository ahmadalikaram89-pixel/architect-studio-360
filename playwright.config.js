// إعداد Playwright لاختبارات E2E الدائمة (مجلد e2e/) — بتشتغل ضد "next dev" حقيقي فوق
// صفحة اختبار مُحصّنة (app/e2e-harness/page.js، محاكاة Supabase بالذاكرة، بلا وصول
// حقيقي لقاعدة بيانات، ومحذوفة فعلياً من أي بناء إنتاج عبر فحص NODE_ENV).
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // صفحة الاختبار بتتشارك حالة (DB وهمية بالذاكرة)، أفضل تسلسل بلا تشابك
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
        // بيئات CI/sandbox هون بتوفّر Chromium جاهز مسبقاً — نستخدمه لو موجود بدل تنزيل نسخة Playwright الخاصة
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/e2e-harness",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-e2e",
    },
  },
});
