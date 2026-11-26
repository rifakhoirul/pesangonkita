/**
 * PS-009 — Production Smoke Test (pesangon.cvkita.id + api.cvkita.id)
 * Verifikasi live URL produksi TANPA KV write:
 *  - 5 halaman produksi HTTP 200 & SSL
 *  - viewport 375x812: scrollWidth <= clientWidth (no horizontal overflow)
 *  - .money-value tampil 1 baris (anti-wrap Rp)
 *  - 0 console.error / 0 uncaught error di halaman utama
 *  - GET /api/ps/license-status?code=PS-TEST-0000 -> HTTP 404 JSON valid (0 KV write)
 * DILARANG: test.skip, melonggarkan threshold, KV write, menyentuh route hg:.
 */
const { test, expect } = require('@playwright/test');

const BASE = 'https://pesangon.cvkita.id';
const API = 'https://api.cvkita.id';

test.describe('PS-009 prod smoke @375x812', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('kelima halaman produksi HTTP 200 + tanpa overflow + tanpa console error', async ({ page }) => {
    const pages = ['/', '/letter-analyzer.html', '/privacy.html', '/terms.html', '/disclaimer.html'];
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    for (const path of pages) {
      const resp = await page.goto(`${BASE}${path}?z=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
      expect(resp.status(), `HTTP 200 untuk ${path}`).toBe(200);
      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect.soft(overflow.sw, `scrollWidth <= clientWidth di ${path}`).toBeLessThanOrEqual(overflow.cw);
    }
    expect.soft(consoleErrors, '0 console.error/pageerror di seluruh halaman').toEqual([]);
  });

  test('.money-value hero tampil 1 baris (anti-wrap) di kalkulator 375x812', async ({ page }) => {
    await page.goto(`${BASE}/?z=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    // Isi kalkulator: gaji 50jt + tunjangan 15jt, 24 tahun, MENINGGAL (nominal ekstrem > Rp 1 M)
    await page.fill('#input-base-salary', '50000000');
    await page.fill('#input-fixed-allowance', '15000000');
    await page.fill('#input-years', '24');
    await page.selectOption('#select-phk-reason', 'MENINGGAL');
    await page.waitForTimeout(600);

    const heroVisible = await page.locator('#result-net-severance').isVisible();
    expect(heroVisible, 'hero net severance muncul setelah kalkulasi').toBe(true);

    const wraps = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.money-value, .hero-money').forEach((el) => {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return; // skip hidden
        const cs = getComputedStyle(el);
        const rects = el.getClientRects().length;
        const height = el.getBoundingClientRect().height;
        if (rects !== 1 || height > 1.6 * parseFloat(cs.fontSize)) {
          bad.push({ text: el.textContent.trim().slice(0, 30), rects, height, fontSize: cs.fontSize });
        }
      });
      return bad;
    });
    expect.soft(wraps, 'semua .money-value 1 baris (wrap_rp=no)').toEqual([]);
  });

  test('letter-analyzer produksi: harga Pro Rp 29.000 satu baris & notice privasi AI ada', async ({ page }) => {
    await page.goto(`${BASE}/letter-analyzer.html?z=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect.soft(overflow.sw, 'scrollWidth <= clientWidth').toBeLessThanOrEqual(overflow.cw);
    await expect.soft(page.locator('#privacy-ai-notice')).toBeVisible();
    const priceOk = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.money-value')).find((n) => n.textContent.includes('29.000'));
      if (!el) return { ok: false, reason: 'elemen harga Rp 29.000 tidak ditemukan' };
      const cs = getComputedStyle(el);
      return {
        ok: el.getClientRects().length === 1 && el.getBoundingClientRect().height <= 1.6 * parseFloat(cs.fontSize),
        reason: '',
      };
    });
    expect.soft(priceOk.ok, 'harga Rp 29.000 satu baris').toBe(true);
  });

  test('API produksi: license-status kode tidak dikenal -> 404 JSON valid (0 KV write)', async ({ request }) => {
    const resp = await request.get(`${API}/api/ps/license-status?code=PS-TEST-0000`, {
      headers: { Origin: 'https://pesangon.cvkita.id' },
      timeout: 30000,
    });
    expect(resp.status(), 'HTTP 404 untuk kode lisensi tidak valid').toBe(404);
    const body = await resp.json();
    expect(body).toMatchObject({ ok: false, valid: false, quota: 0 });
  });

  test('API produksi: CORS preflight preview-letter mengizinkan origin pesangon', async ({ request }) => {
    const resp = await request.fetch(`${API}/api/ps/preview-letter`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://pesangon.cvkita.id',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
      timeout: 30000,
    });
    expect(resp.status()).toBe(204);
    expect(resp.headers()['access-control-allow-origin']).toBe('https://pesangon.cvkita.id');
  });
});
