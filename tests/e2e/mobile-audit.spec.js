// tests/e2e/mobile-audit.spec.js — PS-008 Playwright E2E Audit (kontrak literal Next_Instruction H9)
// Pemeriksaan wajib: viewport 375x812 & 1280x800; 5 halaman; 0 console.error, 0 pageerror,
// 0 HTTP 404 aset CSS/JS; scrollWidth <= clientWidth; anti-wrap money (nowrap + 1 rect +
// height <= 1.6*fontSize) pada nominal ekstrem > Rp 1 M; tap target >= 44x44;
// notice privasi UU PDP terpisah; screenshot wajib calc-pkwtt-375 / calc-pkwt-375 /
// analyzer-teaser-375 / analyzer-pro-375 di tests/screenshots/.
// DILARANG: test.skip/fixme, melonggarkan threshold, menghapus test lama, mengubah pesangon-engine.js.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.join(process.cwd(), 'tests/screenshots'), { recursive: true });

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

// Tap target eksplisit dari kontrak PS-008 (per halaman)
const EXPLICIT_TARGETS = {
  'index.html': ['#mode-pkwtt', '#mode-pkwt', '#btn-copy-summary', '#btn-reset-form', '#checkbox-pdp-consent'],
  'letter-analyzer.html': ['#btn-mask-pii', '#checkbox-pdp-consent', '#btn-run-teaser', '#btn-run-pro', '#btn-buy-pro', '#btn-activate-license'],
};

function sweepTapTargets() {
  const out = [];
  const els = Array.from(document.querySelectorAll('button, a.nav-link, input, select'));
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue; // hidden
    // Input visual disembunyikan (opacity:0, pola segmented/checkbox DS): hit area = label-nya
    if (cs.opacity === '0') {
      const label = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
      if (!label) { out.push({ sel: '#' + (el.id || el.name || 'input'), h: 0, w: 0, why: 'no-label' }); continue; }
      const lb = label.getBoundingClientRect();
      if (lb.height < 44 || lb.width < 44) out.push({ sel: 'label[for=' + el.id + ']', h: Math.round(lb.height), w: Math.round(lb.width), why: 'label' });
      continue;
    }
    if (box.height < 44 || box.width < 44) {
      out.push({ sel: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0], h: Math.round(box.height), w: Math.round(box.width), why: 'direct' });
    }
  }
  return out;
}

function moneyAudit(sel) {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (cs.display === 'none' || rect.width === 0) return { hidden: true };
  const fs = parseFloat(cs.fontSize);
  return {
    nowrap: cs.whiteSpace === 'nowrap',
    rects: el.getClientRects().length,
    h: Math.round(rect.height),
    maxH: Math.round(fs * 1.6),
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30),
  };
}

async function assertNoConsoleOr404(page, label) {
  const consoleErrors = [];
  const pageErrors = [];
  const notFound = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (/\.(css|js)(\?|$)/.test(r.url()) && r.status() === 404) notFound.push(r.url());
  });
  return { consoleErrors, pageErrors, notFound, label };
}

function expectCleanArtifacts(art) {
  expect(art.consoleErrors, 'console.error harus 0 di ' + art.label).toEqual([]);
  expect(art.pageErrors, 'uncaught pageerror harus 0 di ' + art.label).toEqual([]);
  expect(art.notFound, 'HTTP 404 aset CSS/JS di ' + art.label).toEqual([]);
}

async function shot(page, name) {
  await page.screenshot({ path: 'tests/screenshots/' + name + '.png', fullPage: true });
}

for (const [vpName, w, h] of VIEWPORTS) {
  test.describe('PS-008 audit @' + vpName, () => {
    test.describe.configure({ retries: 0 });

    // ---- 1. Lima halaman: overflow-x + 0 console/404 + tap target >=44x44 ----
    for (const [pName, pFile] of PAGES) {
      test(pName + ': overflow-x=0, console/404 bersih, tap target >=44x44 (' + vpName + ')', async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const art = await assertNoConsoleOr404(page, pFile);
        await page.goto('/' + pFile, { waitUntil: 'networkidle' });
        expectCleanArtifacts(art);

        const ovf = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        expect(ovf.scrollW, 'overflow-x di ' + pFile + ' (' + vpName + ')').toBeLessThanOrEqual(ovf.clientW);

        // Sweep generik sesuai kontrak: button, input, select, a.nav-link
        const violations = await page.evaluate(sweepTapTargets);
        expect(violations, 'tap target <44x44 di ' + pFile + ' (' + vpName + ')').toEqual([]);

        // Target eksplisit kontrak (yang visible di halaman ini)
        for (const t of EXPLICIT_TARGETS[pFile] || []) {
          const loc = page.locator(t);
          if (!(await loc.count())) continue;
          const el = loc.first();
          if (!(await el.isVisible())) continue;
          const box = await el.boundingBox();
          expect(box, t + ' harus punya bounding box').toBeTruthy();
          // Radio segmented: visual disembunyikan opacity:0 → ukur label hit-area-nya
          const op = await el.evaluate((e) => getComputedStyle(e).opacity);
          if (op === '0') {
            const lab = page.locator('label[for="' + t.slice(1) + '"]');
            const lb = await lab.boundingBox();
            expect(lb && lb.height >= 44 && lb.width >= 44, 'hit area label ' + t + ' >=44x44').toBe(true);
          } else {
            expect(box.height, t + ' height >=44 (' + vpName + ')').toBeGreaterThanOrEqual(44);
            expect(box.width, t + ' width >=44 (' + vpName + ')').toBeGreaterThanOrEqual(44);
          }
        }
        await shot(page, 'audit-' + pName + '-' + vpName);
      });
    }

    // ---- 2. Notice privasi UU PDP terpisah (kontrak literal) ----
    test('notice privasi: #privacy-local-notice hanya di index, #privacy-ai-notice hanya di analyzer (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/index.html', { waitUntil: 'networkidle' });
      await expect(page.locator('#privacy-local-notice')).toBeVisible();
      await expect(page.locator('#privacy-ai-notice')).toHaveCount(0);
      await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
      await expect(page.locator('#privacy-ai-notice')).toBeVisible();
      await expect(page.locator('#privacy-local-notice')).toHaveCount(0);
    });

    // ---- 3. Kalkulator nominal ekstrem: anti-wrap money > Rp 1 M ----
    test('kalkulator MENINGGAL ekstrem: money nowrap + 1 baris + tinggi <= 1.6em (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/index.html', { waitUntil: 'networkidle' });
      await page.fill('#input-base-salary', '50000000');
      await page.fill('#input-fixed-allowance', '15000000');
      await page.fill('#input-years', '24');
      await page.selectOption('#select-phk-reason', 'MENINGGAL');
      await page.fill('#input-company-offer', '250000000');
      await expect(page.locator('#result-net-severance')).toContainText('Rp', { timeout: 5000 });

      // Nominal harus mencapai ratusan juta s.d. > Rp 1 M (poling gruping miliar)
      const gross = await page.locator('#result-gross-total').textContent();
      expect(gross.replace(/\s/g, ''), 'nominal ekstrem harus > Rp 1 M').toMatch(/^Rp\d{1,3}(\.\d{3}){3,}$/);

      const CONTAINERS = ['#result-net-severance', '#result-gross-total', '#result-tax-total', '#result-breakdown-list', '#offer-gap-card'];
      for (const c of CONTAINERS) {
        const results = await page.evaluate((sel) => {
          const els = Array.from(document.querySelectorAll(sel));
          const audit = (el) => {
            const cs = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if (cs.display === 'none' || rect.width === 0) return { hidden: true };
            const fsz = parseFloat(cs.fontSize);
            return {
              nowrap: cs.whiteSpace === 'nowrap',
              rects: el.getClientRects().length,
              h: Math.round(rect.height),
              maxH: Math.round(fsz * 1.6),
              text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30),
            };
          };
          return els.map(audit);
        }, c + ' .money-value, ' + c + '.money-value');
        for (const res of results) {
          if (res.hidden) continue;
          expect(res.nowrap, c + ' money nowrap (' + vpName + ')').toBe(true);
          expect(res.rects, c + ' money 1 baris (' + vpName + ')').toBe(1);
          expect(res.h, c + ' tinggi ' + res.h + ' <= 1.6*fontSize ' + res.maxH).toBeLessThanOrEqual(res.maxH);
          expect(res.text).toMatch(/Rp/);
        }
      }
      if (w === 375) await shot(page, 'calc-pkwtt-375');
      else await shot(page, 'audit-kalkulator-ekstrem-' + vpName);
    });

    // ---- 4. Mode PKWT + screenshot calc-pkwt-375 ----
    test('kalkulator PKWT: mode terpilih, tanpa overflow, screenshot 375 (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/index.html', { waitUntil: 'networkidle' });
      await page.click('label[for="mode-pkwt"]');
      await page.fill('#input-base-salary', '8000000');
      await page.fill('#input-pkwt-months', '12');
      await page.check('#toggle-pkwt-early');
      await page.fill('#input-pkwt-remaining', '6');
      const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ovf, 'overflow-x mode PKWT').toBeLessThanOrEqual(0);
      if (w === 375) await shot(page, 'calc-pkwt-375');
    });

    // ---- 5. Analyzer: teaser → aktivasi → pro (mock API), overlap & money 29rb ----
    test('analyzer teaser→pro: mock API, anti-overlap paywall/pro-result, money 1 baris (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.route('**/api/ps/**', (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p.endsWith('/preview-letter')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, docType: 'SURAT_PHK', redFlagsPreview: ['Indikasi klausul menerima penuh tanpa hak pembelaan.'], completenessScore: 45 }) });
        }
        if (p.endsWith('/license-status')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, valid: true, code: 'PS-AB12-CD34', quota: 5, status: 'active' }) });
        }
        if (p.endsWith('/analyze-letter')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, docType: 'SURAT_PHK', completenessScore: 45, redFlags: ['Klausul menerima penuh tanpa pembelaan.', 'Angka pesangon di bawah PP 35/2021.'], hrScripts: ['Skrip 1: Saya mohon transkrip rapat HRD.', 'Skrip 2: Saya belum menandatangani SP.'], checklist: ['Minta surat PHK resmi tertulis.', 'Jangan tanda tangan di hari yang sama.'], quotaRemaining: 4 }) });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      });

      await page.goto('/letter-analyzer.html', { waitUntil: 'networkidle' });
      const TEKS = 'Dengan ini kami beritahukan bahwa terjadi efisiensi dan Anda diberhentikan mulai tanggal ini juga.';

      // Teaser gratis
      await page.fill('#textarea-letter-text', TEKS);
      await page.check('#checkbox-pdp-consent');
      await page.click('#btn-run-teaser');
      await expect(page.locator('#teaser-result-card')).toBeVisible({ timeout: 5000 });
      if (w === 375) await shot(page, 'analyzer-teaser-375');

      // Aktivasi lisensi + Pro
      await page.fill('#input-license-code', 'PS-AB12-CD34');
      await page.click('#btn-activate-license');
      await expect(page.locator('#license-quota-badge')).toContainText('5');
      await page.click('#btn-run-pro');
      await expect(page.locator('#pro-result-card')).toBeVisible({ timeout: 5000 });
      if (w === 375) await shot(page, 'analyzer-pro-375');

      // Anti-overlap: paywall-card vs pro-result-card (jika keduanya visible).
      // Dihitung dalam SATU evaluate agar scroll offset (animasi scrollIntoView smooth)
      // identik untuk kedua elemen — boundingBox terpisah rawan flaky.
      const overlapped = await page.evaluate(() => {
        const pay = document.getElementById('paywall-card');
        const pro = document.getElementById('pro-result-card');
        if (!pay || !pro) return false;
        const rp = pay.getBoundingClientRect();
        const rr = pro.getBoundingClientRect();
        if (rp.width === 0 || rr.width === 0) return false;
        const ox = Math.max(0, Math.min(rp.right, rr.right) - Math.max(rp.left, rr.left));
        const oy = Math.max(0, Math.min(rp.bottom, rr.bottom) - Math.max(rp.top, rr.top));
        return ox > 0 && oy > 0;
      });
      expect(overlapped, 'paywall-card overlap pro-result-card (' + vpName + ')').toBe(false);

      // Money analyzer: Rp 29.000 (paywall-price) + semua .money-value visible harus 1 baris
      const mvs = page.locator('.money-value');
      const n = await mvs.count();
      for (let i = 0; i < n; i++) {
        const el = mvs.nth(i);
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        const fsz = await el.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        expect(box.height, 'analyzer money ke-' + i + ' tinggi <=1.6em').toBeLessThanOrEqual(fsz * 1.6);
        expect(await el.evaluate((e) => getComputedStyle(e).whiteSpace), 'analyzer money nowrap').toBe('nowrap');
        expect(await el.evaluate((e) => e.getClientRects().length), 'analyzer money 1 baris').toBe(1);
      }
    });

    // ---- 6. Checkbox toggle-pkwt-early >=44x44 (pola consent-row DS) ----
    test('toggle-pkwt-early: hit area >=44x44 (' + vpName + ')', async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/index.html', { waitUntil: 'networkidle' });
      await page.click('label[for="mode-pkwt"]');
      const box = await page.locator('#toggle-pkwt-early').boundingBox();
      expect(box).toBeTruthy();
      expect(box.height, 'checkbox toggle-pkwt-early height >=44').toBeGreaterThanOrEqual(44);
      expect(box.width, 'checkbox toggle-pkwt-early width >=44').toBeGreaterThanOrEqual(44);
    });
  });
}
