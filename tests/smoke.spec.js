// PS-001 Smoke test scaffold PesangonCVKita.
// Kriteria lulus (Spec_Summary PS-001 poin 4):
//  - Semua 5 halaman HTML valid & terbuka di server lokal
//  - Playwright 375x812: 0 console error
//  - scrollWidth <= clientWidth (zero horizontal overflow)
//  - ID wajib ada; tap target nav >= 44px; notice privasi terpisah
//  - Tanpa framework CSS eksternal (Tailwind/Bootstrap CDN dilarang)
//  - Cache-bust ?v=1 pada CSS (naik per perubahan CSS; kini ?v=3 sejak PS-004)
const { test, expect } = require('@playwright/test');

const PAGES = [
  { file: 'index.html', mustHave: ['#app-header', '#nav-calc', '#nav-analyzer', '#main-container', '#privacy-local-notice'] },
  { file: 'letter-analyzer.html', mustHave: ['#app-header', '#nav-calc', '#nav-analyzer', '#main-container', '#privacy-ai-notice'] },
  { file: 'privacy.html', mustHave: ['#app-header', '#main-container'] },
  { file: 'terms.html', mustHave: ['#app-header', '#main-container'] },
  { file: 'disclaimer.html', mustHave: ['#app-header', '#main-container'] },
];

test.describe('PS-001 scaffold smoke @375x812', () => {
  for (const p of PAGES) {
    test(`${p.file}: terbuka, valid, tanpa console error, tanpa overflow`, async ({ page }) => {
      const consoleErrors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));

      const resp = await page.goto(`/${p.file}`, { waitUntil: 'networkidle' });
      expect(resp.status()).toBe(200);

      // Halaman valid & kerangka utuh
      for (const sel of p.mustHave) {
        await expect(page.locator(sel)).toBeVisible();
      }
      await expect(page.locator('h1')).toHaveCount(1);
      const lang = await page.getAttribute('html', 'lang');
      expect(lang).toBe('id');
      const charset = await page.getAttribute('meta[charset]', 'charset');
      expect(charset.toLowerCase()).toBe('utf-8');

      // Zero horizontal overflow (kriteria lulus PS-001)
      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw, `scrollWidth ${overflow.sw} > clientWidth ${overflow.cw}`).toBeLessThanOrEqual(overflow.cw);

      // 0 console error (kriteria lulus PS-001)
      expect(consoleErrors, `console error: ${consoleErrors.join(' | ')}`).toEqual([]);
    });
  }

  test('index & letter-analyzer: nav tap target >= 44px, notice privasi terpisah, tanpa CDN CSS, cache-bust ?v=2', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    // Tap target nav >= 44px (DS §5)
    for (const id of ['#nav-calc', '#nav-analyzer']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height, `${id} tinggi ${box.height}px < 44px`).toBeGreaterThanOrEqual(44);
    }

    // Notice privasi lokal & AI HARUS konten berbeda (dilarang disatukan)
    const localNotice = await page.locator('#privacy-local-notice').innerText();
    expect(localNotice.toLowerCase()).toContain('lokal');

    await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
    const aiNotice = await page.locator('#privacy-ai-notice').innerText();
    expect(aiNotice.toLowerCase()).toContain('terenkripsi');

    // Dilarang framework CSS eksternal; CSS lokal wajib cache-bust ?v=N
    // (Google Fonts bukan framework CSS — hanya styling font, diizinkan DS §3)
    // index.html: CSS berubah di PS-003 (kalkulator) -> ?v=2
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    let cssLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href'))
    );
    expect(cssLinks.length).toBeGreaterThanOrEqual(1);
    for (const href of cssLinks) {
      expect(href).not.toMatch(/tailwindcss|bootstrap/i);
    }
    let appCss = cssLinks.filter((h) => !h.includes('fonts.googleapis.com'));
    expect(appCss, 'index harus tepat 1 stylesheet lokal ?v=4 (PS-007 print CSS)').toEqual(['css/styles.css?v=4']);

    // letter-analyzer.html: CSS berubah di PS-007 (@media print) -> ?v=4
    await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
    cssLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href'))
    );
    appCss = cssLinks.filter((h) => !h.includes('fonts.googleapis.com'));
    expect(appCss, 'letter-analyzer harus tepat 1 stylesheet lokal ?v=4 (PS-007 print CSS)').toEqual(['css/styles.css?v=4']);
  });
});
