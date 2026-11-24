// PS-004 — E2E AI Bedah Surat PHK/Resign (mobile 375x812 default + desktop 1280x800).
// Kontrak Spec_Summary PS-004 poin 4:
//  - 15 ID HTML wajib ada
//  - tombol analisis disabled saat checkbox UU PDP belum dicentang, enabled setelahnya
//  - tombol #btn-mask-pii menyamarkan NIK 16 digit & email
//  - dropzone & input tap target >= 44px
//  - tidak ada horizontal overflow / overlap, .money-value Rp 29.000 anti-wrap
//  - mock **/api/ps/preview-letter -> render maks 3 poin ke #teaser-result-card
const { test, expect } = require('@playwright/test');

const REQUIRED_IDS = [
  'pdf-dropzone',
  'input-pdf-file',
  'textarea-letter-text',
  'btn-mask-pii',
  'checkbox-pdp-consent',
  'btn-run-teaser',
  'btn-run-pro',
  'teaser-result-card',
  'pro-result-card',
  'paywall-card',
  'input-license-code',
  'btn-activate-license',
  'btn-buy-pro',
  'license-quota-badge',
  'privacy-ai-notice',
];

const LETTER = 'Dengan ini kami beritahukan bahwa perusahaan melakukan efisiensi karena kerugian, sehingga hubungan kerja diakhiri sesuai Pasal 40 PP 35/2021.';

async function openAnalyzer(page) {
  const resp = await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
  expect(resp.status()).toBe(200);
}

async function assertNoOverflowAndNoOverlap(page) {
  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const boxes = ['#btn-run-teaser', '#btn-run-pro', '#btn-mask-pii', '#license-quota-badge', '#paywall-card']
      .map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      })
      .filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        // #paywall-card & license-quota-badge memang bersarang secara layout,
        // jadi hanya bandingkan elemen yang bukan ancestor (cek irisan nyata).
        const inter = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (inter > 4) overlaps.push(`${a.sel} x ${b.sel}`);
      }
    }
    return {
      sw: de.scrollWidth,
      cw: de.clientWidth,
      overlaps,
      missing: boxes.length,
    };
  });
  expect(metrics.missing, 'semua elemen ukur harus ada').toBe(5);
  expect(metrics.sw, `scrollWidth ${metrics.sw} > clientWidth ${metrics.cw}`).toBeLessThanOrEqual(metrics.cw);
  // paywall-card membungkus badge & tombol -> irisan dengan anaknya wajar; sisanya tidak boleh.
  const realOverlaps = metrics.overlaps.filter((pair) => !pair.includes('#paywall-card'));
  expect(realOverlaps, `overlap: ${realOverlaps.join(', ')}`).toEqual([]);
}

test.describe('PS-004 AI Bedah Surat @375x812', () => {
  test('15 ID wajib hadir, label eksplisit, notice AI terpisah, cache-bust ?v=4 & analyzer.js?v=2 (PS-007)', async ({ page }) => {
    await openAnalyzer(page);

    for (const id of REQUIRED_IDS) {
      await expect(page.locator('#' + id), `#${id} wajib ada`).toHaveCount(1);
    }

    // Notice AI wajib ada; notice lokal kalkulator DILARANG di halaman ini
    await expect(page.locator('#privacy-ai-notice')).toBeVisible();
    await expect(page.locator('#privacy-local-notice')).toHaveCount(0);

    // Label eksplisit untuk input & checkbox (aksesibilitas DS)
    for (const id of ['input-pdf-file', 'textarea-letter-text', 'checkbox-pdp-consent', 'input-license-code']) {
      await expect(page.locator(`label[for="${id}"]`), `label for=${id}`).toHaveCount(1);
    }

    // Input file hanya PDF
    expect(await page.getAttribute('#input-pdf-file', 'accept')).toContain('application/pdf');

    // Cache-bust CSS ?v=4 (PS-007 print CSS) + script analyzer.js?v=2
    const assets = await page.evaluate(() => ({
      css: Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((l) => l.getAttribute('href'))
        .filter((h) => !h.includes('fonts.googleapis.com')),
      scripts: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')),
    }));
    expect(assets.css).toEqual(['css/styles.css?v=4']);
    expect(assets.scripts).toContain('js/analyzer.js?v=2');
  });

  test('gate UU PDP: tombol analisis disabled -> enabled setelah consent + teks >=30 char', async ({ page }) => {
    await openAnalyzer(page);

    const consent = page.locator('#checkbox-pdp-consent');
    const teaser = page.locator('#btn-run-teaser');
    const pro = page.locator('#btn-run-pro');

    // Default: unchecked + tombol disabled
    await expect(consent).not.toBeChecked();
    await expect(teaser).toBeDisabled();
    await expect(pro).toBeDisabled();

    // Teks cukup tapi consent belum dicentang -> tetap disabled
    await page.fill('#textarea-letter-text', LETTER);
    await expect(teaser).toBeDisabled();
    await expect(pro).toBeDisabled();

    // Consent dicentang -> dua tombol aktif
    await page.check('#checkbox-pdp-consent');
    await expect(teaser).toBeEnabled();
    await expect(pro).toBeEnabled();

    // Teks dikosongkan -> kembali disabled (sinkron real-time)
    await page.fill('#textarea-letter-text', '');
    await expect(teaser).toBeDisabled();
    await expect(pro).toBeDisabled();

    // Consent dicabut -> tetap disabled walau teks cukup
    await page.fill('#textarea-letter-text', LETTER);
    await page.uncheck('#checkbox-pdp-consent');
    await expect(teaser).toBeDisabled();
    await expect(pro).toBeDisabled();
  });

  test('tombol Samarkan Data Pribadi menyamarkan NIK 16 digit & email', async ({ page }) => {
    await openAnalyzer(page);

    await page.fill(
      '#textarea-letter-text',
      'Karyawan NIK 3204012503980001 email budi.santoso@gmail.com terkena efisiensi perusahaan sesuai Pasal 40 PP 35/2021.'
    );
    await page.click('#btn-mask-pii');

    const value = await page.inputValue('#textarea-letter-text');
    expect(value).toContain('[NIK_DISAMARKAN]');
    expect(value).toContain('[EMAIL_DISAMARKAN]');
    expect(value).not.toContain('3204012503980001');
    expect(value).not.toContain('budi.santoso@gmail.com');
    await expect(page.locator('#analyzer-status')).toContainText('disamarkan');
  });

  test('teaser gratis: mock API hanya kirim teks, render maks 3 poin, tanpa KV/storage teks surat', async ({ page }) => {
    let requestBody = null;
    await page.route('**/api/ps/preview-letter', async (route) => {
      requestBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          docType: 'Surat PHK',
          redFlagsPreview: ['Poin 1: alasan efisiensi tanpa bukti rugi', 'Poin 2: pesangon di bawah PP 35/2021', 'Poin 3: klausul pelepasan hak', 'Poin 4: tidak boleh tampil'],
          completenessScore: 62,
        }),
      });
    });

    await openAnalyzer(page);
    await page.fill('#textarea-letter-text', LETTER);
    await page.check('#checkbox-pdp-consent');
    await page.click('#btn-run-teaser');

    const card = page.locator('#teaser-result-card');
    await expect(card).toBeVisible();
    await expect(card.locator('h2')).toContainText('Hasil Teaser Gratis');
    await expect(card).toContainText('Surat PHK');
    await expect(card).toContainText('62/100');
    // Maksimal 3 poin red flag (poin ke-4 dipotong di klien)
    await expect(card.locator('li')).toHaveCount(3);

    // Hanya teks yang dikirim — tidak ada file binary PDF
    expect(requestBody).not.toBeNull();
    expect(Object.keys(requestBody)).toEqual(['letterText']);
    expect(requestBody.letterText).toContain('efisiensi');

    // DILARANG menyimpan teks surat ke localStorage (hanya lisensi yang boleh)
    const storage = await page.evaluate(() => ({ ...localStorage }));
    const raw = JSON.stringify(storage);
    expect(raw).not.toContain('efisiensi');
  });

  test('Pro tanpa lisensi: fokus diarahkan ke #paywall-card, tanpa memanggil API', async ({ page }) => {
    let called = false;
    await page.route('**/api/ps/analyze-letter', async (route) => {
      called = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await openAnalyzer(page);
    await page.fill('#textarea-letter-text', LETTER);
    await page.check('#checkbox-pdp-consent');
    await page.click('#btn-run-pro');

    await expect(page.locator('#analyzer-status')).toContainText('lisensi');
    await expect(page.locator('#paywall-card')).toBeVisible();
    expect(called, 'endpoint Pro tidak boleh dipanggil tanpa lisensi valid').toBe(false);
  });

  test('validasi & aktivasi kode lisensi PS-XXXX-XXXX', async ({ page }) => {
    // PS-007: aktivasi WAJIB verifikasi ke server (GET /api/ps/license-status).
    await page.route('**/api/ps/license-status**', async (route) => {
      const code = new URL(route.request().url()).searchParams.get('code');
      const valid = code === 'PS-AB12-CD34';
      await route.fulfill({
        status: valid ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(valid
          ? { ok: true, valid: true, code, quota: 5, status: 'active' }
          : { ok: false, valid: false, quota: 0 }),
      });
    });

    await openAnalyzer(page);

    // Format salah -> pesan error, tidak tersimpan
    await page.fill('#input-license-code', 'SALAH123');
    await page.click('#btn-activate-license');
    await expect(page.locator('#license-activate-status')).toContainText('tidak valid');

    // Format benar tapi tidak ada di server -> pesan tidak ditemukan, tidak tersimpan
    await page.fill('#input-license-code', 'PS-ZZ99-ZZ99');
    await page.click('#btn-activate-license');
    await expect(page.locator('#license-activate-status')).toContainText('tidak ditemukan');
    expect(await page.evaluate(() => localStorage.getItem('ps_license_code_v1'))).toBeNull();

    // Format benar & valid di server -> tersimpan + badge kuota real dari server
    await page.fill('#input-license-code', 'PS-AB12-CD34');
    await page.click('#btn-activate-license');
    await expect(page.locator('#license-activate-status')).toContainText('terpasang');
    await expect(page.locator('#license-quota-badge')).toContainText('PS-AB12-CD34');
    await expect(page.locator('#license-quota-badge')).toContainText('5');
    const saved = await page.evaluate(() => localStorage.getItem('ps_license_code_v1'));
    expect(saved).toBe('PS-AB12-CD34');
  });

  test('Pro dengan lisensi & mock API: render hasil ke #pro-result-card', async ({ page }) => {
    let sentLicense = null;
    await page.route('**/api/ps/analyze-letter', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      sentLicense = body.licenseCode;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          docType: 'Surat PHK',
          completenessScore: 78,
          redFlags: ['Rumus UPMK tidak sesuai Pasal 40', 'Tidak ada bukti efisiensi'],
          hrScripts: ['Skrip 1: minta perhitungan tertulis', 'Skrip 2: negosiasi UPH', 'Skrip 3: ajukan mediasi Disnaker'],
          checklist: ['Fotokopi surat PHK', 'Slip gaji 12 bulan'],
          quotaRemaining: 4,
        }),
      });
    });

    await openAnalyzer(page);
    await page.fill('#input-license-code', 'PS-AB12-CD34');
    await page.click('#btn-activate-license');
    await page.fill('#textarea-letter-text', LETTER);
    await page.check('#checkbox-pdp-consent');
    await page.click('#btn-run-pro');

    const card = page.locator('#pro-result-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Hasil Analisis Pro');
    await expect(card).toContainText('78/100');
    await expect(card).toContainText('negosiasi UPH');
    await expect(page.locator('#license-quota-badge')).toContainText('4');
    expect(sentLicense).toBe('PS-AB12-CD34');
  });

  test('error jaringan teaser ditangani ramah (tanpa crash)', async ({ page }) => {
    await page.route('**/api/ps/preview-letter', (route) => route.abort('failed'));
    await openAnalyzer(page);
    await page.fill('#textarea-letter-text', LETTER);
    await page.check('#checkbox-pdp-consent');
    await page.click('#btn-run-teaser');
    await expect(page.locator('#teaser-result-card')).toContainText('Teaser gratis sedang tidak tersedia');
  });

  test('mobile 375x812: no overflow, no overlap, tap target >=44px, Rp 29.000 anti-wrap', async ({ page }) => {
    await openAnalyzer(page);
    await assertNoOverflowAndNoOverlap(page);

    // Tap target minimal 44px untuk kontrol utama
    for (const sel of ['#pdf-dropzone', '#input-pdf-file', '#textarea-letter-text', '#btn-mask-pii', '#btn-run-teaser', '#btn-run-pro', '#input-license-code', '#btn-activate-license', '#btn-buy-pro', '#checkbox-pdp-consent']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} harus punya bounding box`).not.toBeNull();
      expect(box.height, `${sel} tinggi ${box.height}px < 44px`).toBeGreaterThanOrEqual(44);
    }

    // Nominal Rp 29.000 wajib .money-value + nowrap (guardrail anti-wrap)
    const money = page.locator('#paywall-card .money-value').first();
    await expect(money).toContainText('29.000');
    const style = await money.evaluate((node) => {
      const cs = getComputedStyle(node);
      return { ws: cs.whiteSpace, shrink: cs.flexShrink, nums: cs.fontVariantNumeric, lines: node.getClientRects().length };
    });
    expect(style.ws).toBe('nowrap');
    expect(style.shrink).toBe('0');
    expect(style.nums).toContain('tabular-nums');
    expect(style.lines).toBe(1);
  });
});

test.describe('PS-004 AI Bedah Surat @1280x800', () => {
  test('desktop 1280x800: 15 ID ada, tanpa overflow & tanpa console error', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await openAnalyzer(page);
    for (const id of REQUIRED_IDS) {
      await expect(page.locator('#' + id)).toHaveCount(1);
    }
    await assertNoOverflowAndNoOverlap(page);
    expect(consoleErrors, `console error: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('desktop: gate consent & mask PII konsisten', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAnalyzer(page);
    await expect(page.locator('#btn-run-teaser')).toBeDisabled();
    await page.fill('#textarea-letter-text', LETTER);
    await page.check('#checkbox-pdp-consent');
    await expect(page.locator('#btn-run-teaser')).toBeEnabled();
    await page.click('#btn-mask-pii');
    const v = await page.inputValue('#textarea-letter-text');
    expect(v.length).toBeGreaterThan(30);
  });
});
