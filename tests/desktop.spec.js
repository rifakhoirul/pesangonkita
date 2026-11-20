// PS-001 Verifikasi desktop 1280x800 (langkah 6: E2E mobile 375x812 + desktop 1280x800).
const { test, expect } = require('@playwright/test');

const PAGES = ['index.html', 'letter-analyzer.html', 'privacy.html', 'terms.html', 'disclaimer.html'];

test.describe('PS-001 desktop 1280x800', () => {
  for (const file of PAGES) {
    test(`${file}: desktop 1280x800 tanpa console error & tanpa overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const consoleErrors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));

      const resp = await page.goto(`/${file}`, { waitUntil: 'networkidle' });
      expect(resp.status()).toBe(200);

      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw, `desktop scrollWidth ${overflow.sw} > ${overflow.cw}`).toBeLessThanOrEqual(overflow.cw);
      expect(consoleErrors, `desktop console error: ${consoleErrors.join(' | ')}`).toEqual([]);
    });
  }
});
