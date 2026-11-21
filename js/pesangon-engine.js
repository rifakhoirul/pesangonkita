/**
 * PesangonCVKita — Pure Engine PS-002
 * Perhitungan Uang Pesangon (UP), Uang Penghargaan Masa Kerja (UPMK),
 * Uang Penggantian Hak (UPH), Kompensasi & Ganti Rugi PKWT,
 * serta PPh 21 Final atas Pesangon (PP 68/2009).
 *
 * Referensi: PP No. 35 Tahun 2021 (Pasal 40 ayat (2) & (3), Pasal 15-16)
 * dan PP No. 68 Tahun 2009 (tarif progresif PPh 21 Final pesangon).
 *
 * Aturan kontrak (Spec_Summary PS-002):
 *  - 100% pure: tanpa network, tanpa storage, tanpa DOM.
 *  - Tanpa komponen UPH 15% perumahan/pengobatan (dihapus PP 35/2021).
 *  - Pembulatan ke integer Rupiah terdekat PER KOMPONEN (tanpa rounding liar).
 *  - Dijalankan di browser (objek global PesangonEngine) dan Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PesangonEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Matriks pengali berdasarkan alasan PHK (PP 35/2021) — kontrak PS-002.
   * upMultiplier / upmkMultiplier mengalikan jumlah UP / UPMK penuh
   * (hasil tabel Pasal 40), BUKAN pengali masa kerja langsung.
   */
  var PHK_SCENARIOS = {
    EFISIENSI_RUGI: {
      label: 'Efisiensi karena Perusahaan Rugi',
      upMultiplier: 0.5,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    EFISIENSI_CEGAH_RUGI: {
      label: 'Efisiensi untuk Mencegah Rugi',
      upMultiplier: 1,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    MERGER_AKUISISI: {
      label: 'Merger, Konsolidasi, atau Akuisisi',
      upMultiplier: 1,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    TUTUP_RUGI: {
      label: 'Perusahaan Tutup karena Rugi',
      upMultiplier: 0.5,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    PENSIUN: {
      label: 'Pensiun',
      upMultiplier: 1.75,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    MENINGGAL: {
      label: 'Pekerja Meninggal Dunia',
      upMultiplier: 2,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    SAKIT_BERKEPANJANGAN: {
      label: 'Gangguan Kesehatan Berkepanjangan / Cacat',
      upMultiplier: 2,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    PELANGGARAN_SP: {
      label: 'Pelanggaran Tata Tertib setelah Surat Peringatan ke-3',
      upMultiplier: 0.5,
      upmkMultiplier: 1,
      uph: true,
      uangPisah: false,
    },
    RESIGN: {
      label: 'Mengundurkan Diri (Resign)',
      upMultiplier: 0,
      upmkMultiplier: 0,
      uph: true,
      uangPisah: true,
    },
  };

  /**
   * Lapisan tarif progresif PPh 21 Final atas pesangon (PP 68/2009):
   * 0% <= Rp50 jt; 5% >50-100 jt; 15% >100-500 jt; 25% >500 jt.
   */
  var TAX_BRACKETS_PP68 = [
    { upTo: 50000000, rate: 0 },
    { upTo: 100000000, rate: 0.05 },
    { upTo: 500000000, rate: 0.15 },
    { upTo: Infinity, rate: 0.25 },
  ];

  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function roundRp(v) {
    return Math.round(v);
  }

  /** Pengali UP tabel Pasal 40 ayat (2) PP 35/2021 dari masa kerja (tahun, boleh fraksional). */
  function upMultiplierFor(years) {
    var y = num(years);
    if (y < 1) return 1;
    return Math.min(9, Math.floor(y) + 1);
  }

  /** Pengali UPMK tabel Pasal 40 ayat (3) PP 35/2021 dari masa kerja (tahun, boleh fraksional). */
  function upmkMultiplierFor(years) {
    var y = num(years);
    if (y < 3) return 0;
    if (y < 6) return 2;
    if (y < 9) return 3;
    if (y < 12) return 4;
    if (y < 15) return 5;
    if (y < 18) return 6;
    if (y < 21) return 7;
    if (y < 24) return 8;
    return 10;
  }

  /**
   * Uang Pesangon penuh (sebelum pengali skenario).
   * Tabel: <1 thn=1x, 1=2x, 2=3x, 3=4x, 4=5x, 5=6x, 6=7x, 7=8x, >=8=9x.
   */
  function calculateUP(years, monthlyWage) {
    return roundRp(upMultiplierFor(years) * num(monthlyWage));
  }

  /**
   * Uang Penghargaan Masa Kerja penuh (sebelum pengali skenario).
   * Tabel: <3 thn=0x, 3-<6=2x, 6-<9=3x, 9-<12=4x, 12-<15=5x,
   * 15-<18=6x, 18-<21=7x, 21-<24=8x, >=24=10x.
   */
  function calculateUPMK(years, monthlyWage) {
    return roundRp(upmkMultiplierFor(years) * num(monthlyWage));
  }

  /**
   * Uang Penggantian Hak (Pasal 40 ayat (4) PP 35/2021):
   * nilai cuti = round((sisa_cuti / 25) x upah) + ongkos pulang + UPH lainnya.
   * Komponen 15% perumahan/pengobatan SENGAJA tidak ada (dihapus PP 35/2021).
   */
  function calculateUPH(monthlyWage, unusedLeaveDays, transportCost, otherUph) {
    var leaveValue = roundRp((num(unusedLeaveDays) / 25) * num(monthlyWage));
    return leaveValue + roundRp(num(transportCost)) + roundRp(num(otherUph));
  }

  /**
   * PPh 21 Final atas pesangon (PP 68/2009), berlapis progresif.
   * Return { total, breakdown: [{ from, to, rate, taxableBase, tax }] },
   * pajak tiap lapisan dibulatkan ke rupiah terdekat.
   */
  function calculateSeveranceTax(grossAmount) {
    var g = Math.max(0, Math.round(Number(grossAmount) || 0));
    var lower = 0;
    var total = 0;
    var breakdown = [];
    for (var i = 0; i < TAX_BRACKETS_PP68.length; i++) {
      var bracket = TAX_BRACKETS_PP68[i];
      if (g <= lower) break;
      var upper = Math.min(g, bracket.upTo);
      var taxableBase = upper - lower;
      var tax = roundRp(taxableBase * bracket.rate);
      breakdown.push({
        from: lower,
        to: bracket.upTo,
        rate: bracket.rate,
        taxableBase: taxableBase,
        tax: tax,
      });
      total += tax;
      lower = bracket.upTo;
      if (bracket.upTo === Infinity) break;
    }
    return { total: total, breakdown: breakdown };
  }

  /**
   * Kompensasi & Ganti Rugi PKWT (Pasal 15-16 PP 35/2021).
   * Kompensasi berhak jika masa kerja minimal 1 bulan terus-menerus:
   *   round((masa_kerja_bulan / 12) x upah_bulanan).
   * Ganti rugi (jika diputus sebelum kontrak berakhir):
   *   sisa bulan kontrak x upah bulanan.
   */
  function calculatePKWTCompensation(monthsWorked, remainingMonths, monthlyWage, isEarlyTermination) {
    var months = num(monthsWorked);
    var kompensasi = months >= 1 ? roundRp((months / 12) * num(monthlyWage)) : 0;
    var gantiRugi = isEarlyTermination ? roundRp(num(remainingMonths) * num(monthlyWage)) : 0;
    return { kompensasi: kompensasi, gantiRugi: gantiRugi, total: kompensasi + gantiRugi };
  }

  /**
   * Gabungan PKWTT/PKWT: komponen, bruto, pajak final, netto, dan
   * selisih terhadap companyOffer (Tawaran Perusahaan vs Hak Normatif).
   *
   * input = {
   *   employmentType: 'PKWTT' | 'PKWT' (default 'PKWTT'),
   *   monthlyWage, years, months,
   *   phkScenario (key PHK_SCENARIOS, wajib utk PKWTT),
   *   unusedLeaveDays, transportCost, otherUph, uangPisah,
   *   monthsWorked, remainingMonths, isEarlyTermination (utk PKWT),
   *   companyOffer (opsional)
   * }
   *
   * Status gap: 'KURANG_BAYAR' (tawaran < hak normatif, toleransi Rp 1),
   * 'SESUAI', 'LEBIH_TINGGI' (tawaran > hak normatif); null jika tak ada offer.
   */
  function calculateFullSeverance(input) {
    input = input || {};
    var wage = num(input.monthlyWage);
    var years = num(input.years) + (num(input.months) / 12);
    var isPkwt = input.employmentType === 'PKWT';
    var components = {};
    var detail = {};
    var gross = 0;

    if (isPkwt) {
      var pkwt = calculatePKWTCompensation(
        input.monthsWorked,
        input.remainingMonths,
        wage,
        !!input.isEarlyTermination
      );
      components.kompensasiPKWT = pkwt.kompensasi;
      components.gantiRugiPKWT = pkwt.gantiRugi;
      gross = pkwt.total;
    } else {
      var scenarioKey = input.phkScenario;
      var scenario = PHK_SCENARIOS[scenarioKey];
      if (!scenario) {
        throw new Error('Skenario PHK tidak dikenal: ' + scenarioKey);
      }
      var upFull = calculateUP(years, wage);
      var upmkFull = calculateUPMK(years, wage);
      components.up = roundRp(upFull * scenario.upMultiplier);
      components.upmk = roundRp(upmkFull * scenario.upmkMultiplier);
      components.uph = scenario.uph
        ? calculateUPH(wage, input.unusedLeaveDays, input.transportCost, input.otherUph)
        : 0;
      components.uangPisah = scenario.uangPisah ? roundRp(num(input.uangPisah)) : 0;
      gross = components.up + components.upmk + components.uph + components.uangPisah;
      detail.upMultiplier = upMultiplierFor(years);
      detail.upmkMultiplier = upmkMultiplierFor(years);
      detail.scenarioUpMultiplier = scenario.upMultiplier;
      detail.scenarioUpmkMultiplier = scenario.upmkMultiplier;
    }

    var tax = calculateSeveranceTax(gross);
    var netTotal = gross - tax.total;

    var offerRaw = input.companyOffer;
    var offer = offerRaw !== null && offerRaw !== undefined && offerRaw !== '' ? Number(offerRaw) : null;
    var gap = null;
    if (offer !== null && isFinite(offer) && offer > 0) {
      offer = Math.round(offer);
      var difference = netTotal - offer;
      var status;
      if (Math.abs(difference) <= 1) {
        status = 'SESUAI';
      } else if (difference > 0) {
        status = 'KURANG_BAYAR';
      } else {
        status = 'LEBIH_TINGGI';
      }
      gap = {
        difference: difference,
        percent: Math.round((difference / offer) * 10000) / 100,
        status: status,
      };
    }

    return {
      employmentType: isPkwt ? 'PKWT' : 'PKWTT',
      scenario: isPkwt ? null : input.phkScenario,
      components: components,
      detail: detail,
      grossTotal: gross,
      tax: tax,
      netTotal: netTotal,
      companyOffer: offer,
      gap: gap,
    };
  }

  return {
    PHK_SCENARIOS: PHK_SCENARIOS,
    TAX_BRACKETS_PP68: TAX_BRACKETS_PP68,
    upMultiplierFor: upMultiplierFor,
    upmkMultiplierFor: upmkMultiplierFor,
    calculateUP: calculateUP,
    calculateUPMK: calculateUPMK,
    calculateUPH: calculateUPH,
    calculateSeveranceTax: calculateSeveranceTax,
    calculatePKWTCompensation: calculatePKWTCompensation,
    calculateFullSeverance: calculateFullSeverance,
  };
});
