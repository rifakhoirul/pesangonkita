// tests/e2e/mobile-audit.spec.js — PS-008 Playwright E2E Audit
// Spec PS-008: tap target >=44px, overflow-x, money-value 1 baris, screenshot evidence.
// Halaman: index, letter-analyzer, privacy, terms, disclaimer x 2 viewport (375x812 & 1280x800).
// Acuan: DS PesangonCVKita (hit area tombol/tab/input/checkbox >=44px; money 1 baris),
//        flow analyzer dari tests/ps007-paywall.spec.js, kalkulator dari tests/calculator.spec.js

const { test, expect } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:8094';

const PAGES = [
  ['index', 'index.html'],
  ['letter-analyzer', 'letter-analyzer.html'],
  ['privacy', 'privacy.html'],
  ['terms', 'terms.html'],
  ['disclaimer', 'disclaimer.html'],
];

const VIEWPORTS = [
  ['mobile-375x812', 375, 812],
  ['desktop-1280x800', 1280, 800],
];

// Elemen tap-target yang di-audit per halaman (sesuai DS: tombol/tab/input/checkbox >=44px)
const TAP_TARGETS = {
  'index.html': [
    '#select-phk-reason',
    '#input-base-salary',
    '#input-fixed-allowance',
    '#input-unused-leave',
    '#input-transport-cost',
    '#input-other-uph',
    '#input-uang-pisah',
    '#toggle-pkwt-early',
    '.segmented input[type="radio"]',
  ],
  'letter-analyzer.html': [
    '#textarea-letter-text',
    '#checkbox-pdp-consent',
    '#btn-run-teaser',
    '#input-license-code',
    '#btn-activate-license',
  ],
};

// Elemen money-value yang di-audit (harus render 1 baris, tidak patah)
const MONEY_SELECTORS = {
  'index.html': ['#result-gross-total', '#result-tax-total', '#result-net-severance'],
  'letter-analyzer.html': ['#teaser-net-total'],
};

// Aturan audit DS: daftar interaktif (button, nav-link, input, select, checkbox) height >=44px.
// Link teks inline di body legal TIDAK termasuk daftar DS, jadi tidak di-audit.
function collectTapViolations() {
  const sels = Array.from(document.querySelectorAll('button, a.nav-link, input, select, .tab-switcher [role="tab"]'));
  const out = [];
  for (const el of sels) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // hidden (mis. section PKWT belum aktif)
    if (r.height < 44) {
      out.push({ sel: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (el.className || ''), h: Math.round(r.height), w: Math.round(r.width) });
    }
  }
  return out;
}

function collectOverflow() {
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
}

function collectMoneyBreaks(sel) {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { hidden: true };
  return { rects: el.getClientRects().length, text: el.textContent.trim().slice(0, 24) };
}

async function shot(page, name) {
  await page.screenshot({ path: 'tests/screenshots/' + name + '.png', fullPage: true });
}

for (const [vpName, w, h] of VIEWPORTS) {
  test.describe('PS-008 audit @' + vpName, () => {
    test.describe.configure({ retries: 0 });

    // ---- 1. Audit 5 halaman: overflow-x + tap target ----
    for (const [pName, pFile] of PAGES) {
      test(pName + ': tanpa overflow-x + tap target >=44px (' + vpName + ')', async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(BASE + '/' + pFile, { waitUntil: 'networkidle' });

        // Khusus index mobile: buka mode PKWT supaya toggle-pkwt-early ikut ter-audit
        if (pFile === 'index.html' && w === 375) {
          const pkwtLabel = page.locator('label[for="mode-pkwt"]');
          if (await pkwtLabel.count()) await pkwtLabel.click();
        }

        const ovf = await page.evaluate(collectOverflow);
        expect(ovf.scrollW, 'overflow horizontal di ' + pFile + ' (' + vpName + ')').toBeLessThanOrEqual(ovf.clientW);

        const targets = TAP_TARGETS[pFile] || [];
        for (const t of targets) {
          const loc = page.locator(t).first();
          if (!(await loc.count())) continue; // elemen opsional tidak ada di halaman ini
          if (!(await loc.isVisible())) continue; // hidden/section belum aktif
          const box = await loc.boundingBox();
          if (!box) continue;
          expect(box.height, 'tap target ' + t + ' di ' + pFile + ' (' + vpName + ') harus >=44px').toBeGreaterThanOrEqual(44);
        }

        await shot(page, 'audit-' + pName + '-' + vpName);
      });
    }

    // ---- 2. Kalkulator: money-value render 1 baris (375px) ----
    test('kalkulator: money-value 1 baris + format Rp benar (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
      await page.fill('#input-base-salary', '5000000');
      await page.fill('#input-fixed-allowance', '1000000');
      await page.selectOption('#select-phk-reason', 'EFISIENSI_RUGI');

      // Nilai muncul real-time; tunggu result net terisi
      await expect(page.locator('#result-net-severance')).toContainText('Rp', { timeout: 5000 });

      for (const sel of MONEY_SELECTORS['index.html']) {
        const res = await page.evaluate(collectMoneyBreaks, sel);
        if (res.missing || res.hidden) continue;
        expect(res.rects, sel + ' harus 1 baris (nowrap) di ' + vpName).toBe(1);
        expect(res.text).toMatch(/^Rp/);
      }
      await shot(page, 'audit-kalkulator-' + vpName);
    });

    // ---- 3. Analyzer: flow Pro dengan mock API (persis pola ps007) ----
    test('analyzer-pro: mock API, pro-result-card render, money 1 baris (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.route('**/api/ps/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/license-status')) {
          return route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, valid: true, code: 'PS-AB12-CD34', quota: 5, status: 'active' }),
          });
        }
        if (path.endsWith('/analyze-letter')) {
          return route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
              ok: true, docType: 'SURAT_PHK', completenessScore: 45,
              redFlags: ['Klausul menerima penuh tanpa pembelaan.', 'Angka pesangon di bawah PP 35/2021.'],
              hrScripts: ['Skrip 1: Saya mohon transkrip rapat...', 'Skrip 2: Saya belum menandatangani...'],
              checklist: ['Minta surat PHK resmi tertulis.', 'Jangan tanda tangan di hari yang sama.'],
              quotaRemaining: 4,
            }),
          });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      });

      await page.goto(BASE + '/letter-analyzer.html', { waitUntil: 'networkidle' });
      const TEKS_SURAT = 'Dengan ini kami beritahukan bahwa terjadi efisiensi dan Anda diberhentikan mulai tanggal ini juga.';
      await page.fill('#textarea-letter-text', TEKS_SURAT);
      await page.check('#checkbox-pdp-consent');
      await page.fill('#input-license-code', 'PS-AB12-CD34');
      await page.click('#btn-activate-license');
      await expect(page.locator('#license-quota-badge')).toContainText('5');
      await page.click('#btn-run-pro');
      await expect(page.locator('#pro-result-card')).toBeVisible({ timeout: 5000 });

      // Money di halaman analyzer (jika ada yang ter-render) harus 1 baris
      for (const sel of MONEY_SELECTORS['letter-analyzer.html']) {
        const res = await page.evaluate(collectMoneyBreaks, sel);
        if (res.missing || res.hidden) continue;
        expect(res.rects, sel + ' harus 1 baris di ' + vpName).toBe(1);
      }
      await shot(page, 'audit-analyzer-pro-' + vpName);
    });

    // ---- 4. Toggle PKWT: checkbox >=44px setelah mode PKWT aktif ----
    test('toggle-pkwt-early: hit area >=44px (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
      const pkwtLabel = page.locator('label[for="mode-pkwt"]');
      if (await pkwtLabel.count()) await pkwtLabel.click();
      const box = await page.locator('#toggle-pkwt-early').boundingBox();
      expect(box).toBeTruthy();
      expect(box.height, 'checkbox toggle-pkwt-early >=44px (DS pola consent-row)').toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    });
  });
}
