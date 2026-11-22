// PS-003 — E2E kalkulator pesangon (mobile 375x812 default dari playwright.config.js).
// Angka expected di bawah dihitung dari js/pesangon-engine.js yang sama yang dipakai UI
// (diverifikasi langsung via Node, bukan tebakan):
//   A: PKWTT 5jt+1jt, 3th6bln, efisiensi rugi, cuti 12, transport 500rb -> net 27.380.000
//   B: PKWT 12 bln kerja, sisa 6, diputus awal, upah 6jt             -> net 42.000.000
//   C: A + tawaran 25jt -> gap KURANG_BAYAR selisih 2.380.000 (9.52%)
//   D: 50jt, 20 th efisiensi rugi -> gross 575.000.000, tax 81.250.000, net 493.750.000
const { test, expect } = require('@playwright/test');

const RP = (n) => 'Rp\u00A0' + n;

async function expectRp(page, id, n) {
  const txt = await page.locator('#' + id).textContent();
  expect(txt.trim()).toBe(RP(n));
}

async function fillByLabel(page, id, value) {
  await page.fill('#' + id, value);
}

test.describe('PS-003 kalkulator @375x812', () => {
  test('PKWTT efisiensi rugi: hasil real-time, breakdown, pajak nihil, localStorage', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    // Hero & pajak mulai dari 0
    await expectRp(page, 'result-net-severance', '0');

    await fillByLabel(page, 'input-base-salary', '5000000');
    await fillByLabel(page, 'input-fixed-allowance', '1000000');
    await fillByLabel(page, 'input-years', '3');
    await fillByLabel(page, 'input-months', '6');
    await fillByLabel(page, 'input-unused-leave', '12');
    await fillByLabel(page, 'input-transport-uph', '500000');

    await expectRp(page, 'result-net-severance', '27.380.000');
    await expectRp(page, 'result-gross-total', '27.380.000');
    await expectRp(page, 'result-tax-total', '0');

    // Breakdown: UP (0.5), UPMK, UPH — 3 baris komponen
    const rows = page.locator('#result-breakdown-list .breakdown-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Uang Pesangon');
    await expect(rows.nth(1)).toContainText('UPMK');
    await expect(rows.nth(2)).toContainText('UPH');
    await expect(rows.nth(0)).toContainText('0,5');

    // Catatan wajib PRD §5.6: Bukti Potong PPh 21 Final
    await expect(page.locator('#tax-note')).toContainText('Bukti Potong PPh 21 Final');

    // Simpan Lokal: state tersimpan otomatis di localStorage ps_last_calc_v1
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ps_last_calc_v1') || '{}'));
    expect(saved['input-base-salary']).toBe('5000000');
    expect(saved['select-phk-reason']).toBe('EFISIENSI_RUGI');
  });

  test('PKWT diputus awal: kompensasi + ganti rugi, tanpa baris UP/UPMK', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    await page.click('label[for="mode-pkwt"]');
    await expect(page.locator('#pkwt-fields')).toBeVisible();
    await expect(page.locator('#pkwtt-fields')).toBeHidden();

    await fillByLabel(page, 'input-base-salary', '6000000');
    await fillByLabel(page, 'input-pkwt-months', '12');
    await page.check('#toggle-pkwt-early');

    // Field sisa kontrak + note muncul hanya saat toggle aktif
    await expect(page.locator('#pkwt-remaining-field')).toBeVisible();
    await fillByLabel(page, 'input-pkwt-remaining', '6');

    await expectRp(page, 'result-net-severance', '42.000.000');
    const rows = page.locator('#result-breakdown-list .breakdown-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Kompensasi PKWT');
    await expect(rows.nth(1)).toContainText('Ganti Rugi PKWT');
  });

  test('Pembanding tawaran: gap KURANG_BAYAR tampil dalam Rp dan persen', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    await fillByLabel(page, 'input-base-salary', '5000000');
    await fillByLabel(page, 'input-fixed-allowance', '1000000');
    await fillByLabel(page, 'input-years', '3');
    await fillByLabel(page, 'input-months', '6');
    await fillByLabel(page, 'input-unused-leave', '12');
    await fillByLabel(page, 'input-transport-uph', '500000');
    await fillByLabel(page, 'input-company-offer', '25000000');

    const gap = page.locator('#offer-gap-card');
    await expect(gap).toBeVisible();
    await expect(gap.locator('[data-gap-status]')).toContainText('Kurang Bayar');
    const diffTxt = await page.locator('[data-gap-diff]').textContent();
    expect(diffTxt.trim()).toBe(RP('2.380.000'));
    await expect(gap.locator('[data-gap-percent]')).toContainText('9,52%');
  });

  test('Anti-wrap Rp 500jt+: hero tetap 1 baris, tanpa overflow horizontal', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    await fillByLabel(page, 'input-base-salary', '50000000');
    await fillByLabel(page, 'input-years', '20');

    await expectRp(page, 'result-gross-total', '575.000.000');
    await expectRp(page, 'result-tax-total', '81.250.000');
    await expectRp(page, 'result-net-severance', '493.750.000');

    // .money-value & .hero-money wajib nowrap (NI PS-003)
    const ws = await page.evaluate(() => {
      const hero = document.querySelector('#result-net-severance');
      const row = document.querySelector('#result-gross-total');
      return {
        hero: getComputedStyle(hero).whiteSpace,
        row: getComputedStyle(row).whiteSpace,
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      };
    });
    expect(ws.hero).toBe('nowrap');
    expect(ws.row).toBe('nowrap');
    expect(ws.sw).toBeLessThanOrEqual(ws.cw);
  });

  test('Reset form: kosongkan input, hasil kembali 0, localStorage dibersihkan', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    await fillByLabel(page, 'input-base-salary', '5000000');
    await fillByLabel(page, 'input-years', '3');
    const before = await page.locator('#result-net-severance').textContent();
    expect(before.trim()).not.toBe(RP('0'));

    await page.click('#btn-reset-form');
    await expect(page.locator('#input-base-salary')).toHaveValue('');
    await expect(page.locator('#input-years')).toHaveValue('');
    await expectRp(page, 'result-net-severance', '0');

    const saved = await page.evaluate(() => localStorage.getItem('ps_last_calc_v1'));
    expect(saved).toBeNull();
  });
});
