/**
 * PS-002 — Unit test PesangonEngine (Vitest).
 * Cakupan wajib Spec_Summary PS-002:
 *  - Batas masa kerja UP & UPMK (0 / <1 / 1 / 3 / 6 / 8 / 24 tahun)
 *  - Ke-9 skenario PHK_SCENARIOS
 *  - Kompensasi & ganti rugi PKWT (<1 bulan, 12 bulan, putus dini)
 *  - 4 lapisan progresif calculateSeveranceTax (<=50jt, 75jt, 250jt, 600jt
 *    termasuk batas 50jt / 100jt / 500jt)
 *  - Integrasi calculateFullSeverance + gap tawaran perusahaan
 * DILARANG ada network/KV/DOM di engine — dijaga test "pure engine".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import engine from '../js/pesangon-engine.js';

const {
  PHK_SCENARIOS,
  TAX_BRACKETS_PP68,
  calculateUP,
  calculateUPMK,
  calculateUPH,
  calculateSeveranceTax,
  calculatePKWTCompensation,
  calculateFullSeverance,
} = engine;

const JT = 1_000_000;

describe('Kontrak konstanta PS-002', () => {
  it('PHK_SCENARIOS berisi tepat 9 kunci dengan pengali sesuai kontrak', () => {
    const expected = {
      EFISIENSI_RUGI: [0.5, 1, true, false],
      EFISIENSI_CEGAH_RUGI: [1, 1, true, false],
      MERGER_AKUISISI: [1, 1, true, false],
      TUTUP_RUGI: [0.5, 1, true, false],
      PENSIUN: [1.75, 1, true, false],
      MENINGGAL: [2, 1, true, false],
      SAKIT_BERKEPANJANGAN: [2, 1, true, false],
      PELANGGARAN_SP: [0.5, 1, true, false],
      RESIGN: [0, 0, true, true],
    };
    expect(Object.keys(PHK_SCENARIOS).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, [up, upmk, uph, pisah]] of Object.entries(expected)) {
      expect(PHK_SCENARIOS[key], key).toMatchObject({
        upMultiplier: up,
        upmkMultiplier: upmk,
        uph: uph,
        uangPisah: pisah,
      });
    }
  });

  it('TAX_BRACKETS_PP68 berlapis 0% / 5% / 15% / 25% (PP 68/2009)', () => {
    expect(TAX_BRACKETS_PP68.map((b) => b.rate)).toEqual([0, 0.05, 0.15, 0.25]);
    expect(TAX_BRACKETS_PP68.map((b) => b.upTo)).toEqual([50 * JT, 100 * JT, 500 * JT, Infinity]);
  });
});

describe('calculateUP — Pasal 40 ayat (2) PP 35/2021', () => {
  it('batas bawah: 0 tahun dan <1 tahun = 1x upah', () => {
    expect(calculateUP(0, 5 * JT)).toBe(5 * JT);
    expect(calculateUP(0.99, 5 * JT)).toBe(5 * JT);
  });

  it('1 tahun = 2x, 3 tahun = 4x, 6 tahun = 7x', () => {
    expect(calculateUP(1, 5 * JT)).toBe(10 * JT);
    expect(calculateUP(3, 5 * JT)).toBe(20 * JT);
    expect(calculateUP(6, 5 * JT)).toBe(35 * JT);
  });

  it('batas atas: 8 tahun dan 24 tahun = 9x upah', () => {
    expect(calculateUP(8, 5 * JT)).toBe(45 * JT);
    expect(calculateUP(24, 5 * JT)).toBe(45 * JT);
  });
});

describe('calculateUPMK — Pasal 40 ayat (3) PP 35/2021', () => {
  it('<3 tahun = 0x', () => {
    expect(calculateUPMK(0, 5 * JT)).toBe(0);
    expect(calculateUPMK(2.9, 5 * JT)).toBe(0);
  });

  it('3 tahun = 2x, 6 tahun = 3x', () => {
    expect(calculateUPMK(3, 5 * JT)).toBe(10 * JT);
    expect(calculateUPMK(6, 5 * JT)).toBe(15 * JT);
  });

  it('24 tahun = 10x dan 23.9 tahun = 8x (batas 21-<24)', () => {
    expect(calculateUPMK(24, 5 * JT)).toBe(50 * JT);
    expect(calculateUPMK(23.9, 5 * JT)).toBe(40 * JT);
  });
});

describe('calculateUPH — Pasal 40 ayat (4) PP 35/2021', () => {
  it('nilai cuti = (sisa_cuti / 25) x upah + ongkos pulang + UPH lainnya', () => {
    expect(calculateUPH(5 * JT, 10, 500_000, 250_000)).toBe(2_750_000);
  });

  it('0 hari cuti = ongkos pulang + UPH lainnya saja', () => {
    expect(calculateUPH(5 * JT, 0, 500_000, 0)).toBe(500_000);
  });

  it('pembulatan ke rupiah terdekat (3/25 x 4.999.999 = 599.999,88 -> 600.000)', () => {
    expect(calculateUPH(4_999_999, 3, 0, 0)).toBe(600_000);
  });
});

describe('calculateSeveranceTax — PPh 21 Final PP 68/2009', () => {
  it('batas Rp 50.000.000 tepat = pajak 0 (nihil)', () => {
    const r = calculateSeveranceTax(50 * JT);
    expect(r.total).toBe(0);
    expect(r.breakdown).toHaveLength(1);
  });

  it('Rp 75.000.000 -> lapis 5% saja = Rp 1.250.000', () => {
    expect(calculateSeveranceTax(75 * JT).total).toBe(1_250_000);
  });

  it('batas Rp 100.000.000 tepat = Rp 2.500.000', () => {
    expect(calculateSeveranceTax(100 * JT).total).toBe(2_500_000);
  });

  it('Rp 250.000.000 -> Rp 25.000.000', () => {
    expect(calculateSeveranceTax(250 * JT).total).toBe(25_000_000);
  });

  it('batas Rp 500.000.000 tepat = Rp 62.500.000', () => {
    expect(calculateSeveranceTax(500 * JT).total).toBe(62_500_000);
  });

  it('Rp 600.000.000 -> Rp 87.500.000 (lapis 25% aktif)', () => {
    expect(calculateSeveranceTax(600 * JT).total).toBe(87_500_000);
  });

  it('breakdown berisi taxableBase per lapisan dan total = jumlah pajak lapisan', () => {
    const r = calculateSeveranceTax(600 * JT);
    expect(r.breakdown.map((b) => b.rate)).toEqual([0, 0.05, 0.15, 0.25]);
    expect(r.breakdown.map((b) => b.taxableBase)).toEqual([50 * JT, 50 * JT, 400 * JT, 100 * JT]);
    expect(r.breakdown.reduce((s, b) => s + b.tax, 0)).toBe(r.total);
  });
});

describe('calculatePKWTCompensation — Pasal 15-16 PP 35/2021', () => {
  it('masa kerja <1 bulan: tidak berhak kompensasi (0/0)', () => {
    const r = calculatePKWTCompensation(0, 3, 5 * JT, false);
    expect(r).toEqual({ kompensasi: 0, gantiRugi: 0, total: 0 });
  });

  it('kontrak berakhir sesuai jadwal 12 bulan: kompensasi = 1 bulan upah', () => {
    const r = calculatePKWTCompensation(12, 0, 5 * JT, false);
    expect(r.kompensasi).toBe(5 * JT);
    expect(r.gantiRugi).toBe(0);
    expect(r.total).toBe(5 * JT);
  });

  it('putus dini (10 bulan jalan, sisa 2): kompensasi proporsional + ganti rugi sisa kontrak', () => {
    const r = calculatePKWTCompensation(10, 2, 5 * JT, true);
    expect(r.kompensasi).toBe(4_166_667); // round(10/12 x 5.000.000)
    expect(r.gantiRugi).toBe(10 * JT);
    expect(r.total).toBe(14_166_667);
  });
});

describe('calculateFullSeverance — PKWTT integrasi & gap tawaran', () => {
  const baseInput = {
    employmentType: 'PKWTT',
    monthlyWage: 5 * JT,
    years: 4,
    months: 6, // total 4.5 tahun -> UP 5x, UPMK 2x
    phkScenario: 'EFISIENSI_RUGI',
    unusedLeaveDays: 10,
    transportCost: 500_000,
    otherUph: 250_000,
  };

  it('efisiensi rugi: UP 0.5x, UPMK 1x, UPH masuk, bruto 25.250.000, pajak 0', () => {
    const r = calculateFullSeverance(baseInput);
    expect(r.components.up).toBe(12_500_000); // 25jt x 0.5
    expect(r.components.upmk).toBe(10_000_000);
    expect(r.components.uph).toBe(2_750_000);
    expect(r.components.uangPisah).toBe(0);
    expect(r.grossTotal).toBe(25_250_000);
    expect(r.tax.total).toBe(0);
    expect(r.netTotal).toBe(25_250_000);
  });

  it('gap KURANG_BAYAR: tawaran 20jt vs hak 25.250.000 -> selisih 5.250.000 (26,25%)', () => {
    const r = calculateFullSeverance({ ...baseInput, companyOffer: 20_000_000 });
    expect(r.gap.status).toBe('KURANG_BAYAR');
    expect(r.gap.difference).toBe(5_250_000);
    expect(r.gap.percent).toBe(26.25);
  });

  it('gap SESUAI: tawaran = netto + Rp 1 (toleransi Rp 1)', () => {
    const r = calculateFullSeverance({ ...baseInput, companyOffer: 25_250_001 });
    expect(r.gap.status).toBe('SESUAI');
    expect(r.gap.difference).toBe(-1);
  });

  it('gap LEBIH_TINGGI: tawaran 30jt di atas hak normatif', () => {
    const r = calculateFullSeverance({ ...baseInput, companyOffer: 30_000_000 });
    expect(r.gap.status).toBe('LEBIH_TINGGI');
    expect(r.gap.difference).toBe(-4_750_000);
    expect(r.gap.percent).toBe(-15.83);
  });

  it('meninggal dunia 24 tahun upah 10jt: bruto 280jt, pajak 29.5jt, netto 250.5jt', () => {
    const r = calculateFullSeverance({
      employmentType: 'PKWTT',
      monthlyWage: 10 * JT,
      years: 24,
      months: 0,
      phkScenario: 'MENINGGAL',
      unusedLeaveDays: 0,
      transportCost: 0,
      otherUph: 0,
    });
    expect(r.components.up).toBe(180 * JT); // 9x x 10jt x 2
    expect(r.components.upmk).toBe(100 * JT); // 10x x 10jt
    expect(r.grossTotal).toBe(280 * JT);
    expect(r.tax.total).toBe(29_500_000);
    expect(r.netTotal).toBe(250_500_000);
  });

  it('resign: UP & UPMK 0, uang pisah + UPH tetap dibayar', () => {
    const r = calculateFullSeverance({
      employmentType: 'PKWTT',
      monthlyWage: 5 * JT,
      years: 5,
      months: 0,
      phkScenario: 'RESIGN',
      unusedLeaveDays: 12,
      transportCost: 0,
      otherUph: 0,
      uangPisah: 3_000_000,
    });
    expect(r.components.up).toBe(0);
    expect(r.components.upmk).toBe(0);
    expect(r.components.uph).toBe(2_400_000); // 12/25 x 5jt
    expect(r.components.uangPisah).toBe(3_000_000);
    expect(r.grossTotal).toBe(5_400_000);
    expect(r.netTotal).toBe(5_400_000);
  });

  it('skenario PHK tidak dikenal -> throw (jangan diam-diam 0)', () => {
    expect(() => calculateFullSeverance({ ...baseInput, phkScenario: 'NGAWUR' })).toThrow();
  });
});

describe('calculateFullSeverance — mode PKWT', () => {
  it('PKWT berakhir normal: komponen kompensasiPKWT, tanpa UP/UPMK', () => {
    const r = calculateFullSeverance({
      employmentType: 'PKWT',
      monthlyWage: 5 * JT,
      monthsWorked: 12,
      remainingMonths: 0,
      isEarlyTermination: false,
    });
    expect(r.employmentType).toBe('PKWT');
    expect(r.components.kompensasiPKWT).toBe(5 * JT);
    expect(r.components.gantiRugiPKWT).toBe(0);
    expect(r.grossTotal).toBe(5 * JT);
    expect(r.netTotal).toBe(5 * JT);
    expect(r.components.up).toBeUndefined();
  });
});

describe('Pure engine — tanpa network/KV/DOM (guardrail PS-002)', () => {
  it('js/pesangon-engine.js tidak memakai fetch/XHR/localStorage/DOM', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'pesangon-engine.js'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.|window\.|KV/);
  });
});
