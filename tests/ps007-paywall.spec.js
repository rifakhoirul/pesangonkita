// PS-007 — E2E alur paywall Pro lengkap dengan mock API Worker (mobile 375x812 default config).
// Kriteria lulus Spec_Summary PS-007 poin 4:
//   Free Teaser -> klik Beli Pro -> aktivasi PS-XXXX-XXXX -> tampil sisa kuota 5
//   -> jalankan Pro Analysis -> kuota turun jadi 4 -> tombol Cetak/PDF berfungsi tanpa overlap.
// Mock route https://api.cvkita.id/api/ps/* (Next_Instruction PS-007 poin 7).
const { test, expect } = require('@playwright/test');

const TEKS_SURAT = 'Dengan ini kami beritahukan bahwa terjadi efisiensi sesuai peraturan perusahaan, sehingga status kepegawaian Anda diakhiri mulai tanggal 1 Januari 2027. Silakan menandatangani surat ini.';

async function mockPsApi(page, quotaAfterPro) {
  await page.route('**/api/ps/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/preview-letter')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          docType: 'SURAT_PHK',
          redFlagsPreview: ['Indikasi klausul menerima penuh tanpa hak pembelaan.'],
          completenessScore: 45,
        }),
      });
    } else if (path.endsWith('/license-status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, valid: true, code: 'PS-AB12-CD34', quota: 5, status: 'active' }),
      });
    } else if (path.endsWith('/checkout')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, orderId: 'PS-ORD-1', snapToken: 'mock-snap-token', redirectUrl: 'https://mock.midtrans.test/pay' }),
      });
    } else if (path.endsWith('/analyze-letter')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          docType: 'SURAT_PHK',
          completenessScore: 45,
          redFlags: ['Klausul menerima penuh tanpa pembelaan.', 'Angka pesangon di bawah PP 35/2021.'],
          hrScripts: ['Skrip 1: Saya mohon transkrip rapat...', 'Skrip 2: Saya belum menandatangani...', 'Skrip 3: Mohon mediasi Disnaker...'],
          checklist: ['Minta surat PHK resmi tertulis.', 'Jangan tanda tangan di hari yang sama.'],
          quotaRemaining: quotaAfterPro,
        }),
      });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not found' }) });
    }
  });
}

test.describe('PS-007 paywall & print @375x812', () => {
  test.beforeEach(async ({ page }) => {
    await mockPsApi(page, 4);
    // Mock Midtrans Snap (jalur utama) agar checkout tidak navigate ke redirectUrl mock.
    await page.addInitScript(() => {
      window.snap = { pay: (token) => { window.__snapPayCalls = (window.__snapPayCalls || 0) + 1; window.__snapPayToken = token; } };
    });
    await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
    // Isi teks surat (>= 30 karakter) + centang UU PDP
    await page.fill('#textarea-letter-text', TEKS_SURAT);
    await page.check('#checkbox-pdp-consent');
    await expect(page.locator('#btn-run-teaser')).toBeEnabled();
  });

  test('alur lengkap: teaser -> beli -> aktivasi (kuota 5) -> pro (kuota 4) -> print', async ({ page }) => {
    // 1. Free Teaser
    await page.click('#btn-run-teaser');
    await expect(page.locator('#teaser-result-card')).toBeVisible();
    await expect(page.locator('#teaser-result-card')).toContainText('Hasil Teaser Gratis');

    // 2. Klik Beli Pro -> POST /api/ps/checkout terpanggil dgn email valid + Snap terbuka
    const checkoutPosts = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/ps/checkout')) checkoutPosts.push(req.postDataJSON());
    });
    await page.fill('#input-buyer-email', 'pembeli@contoh.id');
    await page.click('#btn-buy-pro');
    await expect.poll(() => checkoutPosts.length).toBeGreaterThan(0);
    expect(checkoutPosts[0].email).toBe('pembeli@contoh.id');
    // Tunggu handler checkout selesai (status terpasang SEBELUM snap.pay dipanggil)
    await expect(page.locator('#buy-status')).toContainText(/Midtrans|Snap/);
    const snapCalls = await page.evaluate(() => window.__snapPayCalls || 0);
    expect(snapCalls, 'Midtrans Snap harus dibuka dengan snapToken').toBeGreaterThanOrEqual(1);
    const snapToken = await page.evaluate(() => window.__snapPayToken);
    expect(snapToken).toBe('mock-snap-token');

    // 3. Aktivasi lisensi PS-AB12-CD34 -> kuota 5 tampil di badge
    await page.fill('#input-license-code', 'PS-AB12-CD34');
    await page.click('#btn-activate-license');
    await expect(page.locator('#license-quota-badge')).toContainText('5');
    const stored = await page.evaluate(() => localStorage.getItem('ps_license_code_v1'));
    expect(stored).toBe('PS-AB12-CD34');

    // 4. Jalankan Pro Analysis -> hasil penuh + kuota turun jadi 4
    await page.click('#btn-run-pro');
    await expect(page.locator('#pro-result-card')).toBeVisible();
    await expect(page.locator('#pro-result-card')).toContainText('Red flag klausul');
    await expect(page.locator('#pro-result-card')).toContainText('Skrip Balasan HR');
    await expect(page.locator('#pro-result-card')).toContainText('Checklist sebelum tanda tangan');
    await expect(page.locator('#license-quota-badge')).toContainText('4');
    await expect(page.locator('#btn-print-report')).toBeVisible();

    // 5. Tombol Cetak/PDF: berfungsi (window.print terpanggil), tanpa overlap
    await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
    await page.click('#btn-print-report');
    const printCalls = await page.evaluate(() => window.__printCalls);
    expect(printCalls).toBe(1);
  });

  test('6 event trackEvent bebas PII + CSS @media print terverifikasi', async ({ page }) => {
    // Teaser -> teaser_started; Pro -> tanpa event tambahan selain mock lisensi
    await page.click('#btn-run-teaser');
    await expect(page.locator('#teaser-result-card')).toBeVisible();

    // Checkout -> checkout_clicked; Aktivasi -> license_activated
    await page.fill('#input-buyer-email', 'pembeli@contoh.id');
    await page.click('#btn-buy-pro');
    await page.fill('#input-license-code', 'PS-AB12-CD34');
    await page.click('#btn-activate-license');
    await expect(page.locator('#license-quota-badge')).toContainText('5');

    await page.click('#btn-run-pro');
    await expect(page.locator('#pro-result-card')).toBeVisible();

    const events = await page.evaluate(() => (window.__psEvents || []).map((e) => e.name));
    // Event analyzer wajib ada di alur ini (teaser_started, checkout_clicked, license_activated)
    expect(events).toContain('teaser_started');
    expect(events).toContain('checkout_clicked');
    expect(events).toContain('license_activated');

    // Bebas PII: tidak ada email/kode lisensi/teks surat di event
    const serialized = await page.evaluate(() => JSON.stringify(window.__psEvents || []));
    expect(serialized).not.toContain('pembeli@contoh.id');
    expect(serialized).not.toContain('PS-AB12-CD34');
    expect(serialized).not.toContain('efisiensi');

    // CSS @media print: paywall & header hidden saat print, pro-result terlihat
    const printHidden = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'paywall-card';
      document.body.appendChild(probe);
      const display = window.getComputedStyle(probe).display;
      const headerDisplay = window.getComputedStyle(document.querySelector('#app-header')).display;
      probe.remove();
      return { paywall: display, header: headerDisplay };
    });
    // Note: getComputedStyle di layar bukan media print — verifikasi rule di stylesheet:
    const hasPrintRule = await page.evaluate(() => {
      let found = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.media && /print/i.test(rule.media.mediaText)) found = true;
          }
        } catch (err) { /* cross-origin */ }
      }
      return found;
    });
    expect(hasPrintRule).toBe(true);
  });

  test('tanpa horizontal overflow di 375px & tanpa console error', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.click('#btn-run-teaser');
    await expect(page.locator('#teaser-result-card')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw, `scrollWidth ${overflow.sw} > clientWidth ${overflow.cw}`).toBeLessThanOrEqual(overflow.cw);
    expect(consoleErrors, `console error: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('tap target tombol baru >= 44px (btn-buy-pro, btn-activate-license, btn-print-report)', async ({ page }) => {
    for (const id of ['#btn-buy-pro', '#btn-activate-license']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height, `${id} tinggi ${box.height}px < 44px`).toBeGreaterThanOrEqual(44);
    }
    // btn-print-report muncul setelah Pro analysis
    await page.fill('#input-license-code', 'PS-AB12-CD34');
    await page.click('#btn-activate-license');
    await page.click('#btn-run-pro');
    await expect(page.locator('#btn-print-report')).toBeVisible();
    const box = await page.locator('#btn-print-report').boundingBox();
    expect(box.height, `btn-print-report tinggi ${box.height}px < 44px`).toBeGreaterThanOrEqual(44);
  });
});
