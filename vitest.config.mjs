import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // مجلد e2e/ خاص باختبارات Playwright (playwright.config.js) — بنية تشغيل مختلفة
    // كلياً (متصفح حقيقي)، لازم تنستثنى من vitest بدل ما تتضارب معاها. باقي القائمة هون
    // هي نفس الاستثناءات الافتراضية لـ vitest (تحديد exclude يدوياً بيلغي الافتراضي بالكامل)
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "e2e/**",
    ],
  },
});
