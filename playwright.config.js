// Playwright config (PS-001): smoke test scaffold via webServer python http.server
// (file:// memblokir fetch/font; ES module butuh http://). Viewport acuan DS: 375x812.
module.exports = {
  testDir: 'tests',
  // Hanya file *.spec.js (Playwright); *.test.js milik vitest (PS-002).
  testMatch: '**/*.spec.js',
  timeout: 15000,
  webServer: {
    command: 'python3 -m http.server 8094',
    port: 8094,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:8094',
    headless: true,
    viewport: { width: 375, height: 812 }, // mobile-first acuan utama DS §1
  },
  // PS-008: project chromium agar `npx playwright test --project=chromium` jalan
  // (desktop 1280x800 diuji via setViewportSize di dalam spec audit).
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list']],
};
