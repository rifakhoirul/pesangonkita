/**
 * app.js — UI Kalkulator Pesangon (PS-003)
 * 100% client-side: tanpa fetch/XHR, tanpa KV write (PRD §3 & §6 UU PDP).
 * Engine: window.PesangonEngine (js/pesangon-engine.js, PS-002) — tidak diubah.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ps_last_calc_v1';
  var FMT = new Intl.NumberFormat('id-ID');
  var ELS = {};

  // ID wajib (Next_Instruction PS-003). Jangan diubah tanpa alasan kuat.
  var IDS = [
    'mode-pkwtt', 'mode-pkwt',
    'input-base-salary', 'input-fixed-allowance', 'input-years', 'input-months',
    'select-phk-reason', 'input-unused-leave', 'input-transport-uph', 'input-uang-pisah',
    'input-pkwt-months', 'input-pkwt-remaining', 'toggle-pkwt-early',
    'input-company-offer',
    'result-net-severance', 'result-gross-total', 'result-tax-total',
    'result-breakdown-list', 'offer-gap-card',
    'btn-copy-summary', 'btn-reset-form'
  ];

  // PRD §5.5: Uang Pisah hanya untuk skenario Resign / Pelanggaran (PP/PKB).
  var UANG_PISAH_SCENARIOS = { RESIGN: true, PELANGGARAN_SP: true };

  var LABELS = {
    up: 'Uang Pesangon (UP)',
    upmk: 'Uang Penghargaan Masa Kerja (UPMK)',
    uph: 'Uang Penggantian Hak (UPH)',
    uangPisah: 'Uang Pisah',
    kompensasiPKWT: 'Uang Kompensasi PKWT',
    gantiRugiPKWT: 'Ganti Rugi PKWT (sisa kontrak)'
  };

  function cacheEls() {
    for (var i = 0; i < IDS.length; i++) {
      ELS[IDS[i]] = document.getElementById(IDS[i]);
    }
  }

  function el(id) { return ELS[id] || document.getElementById(id); }

  function intVal(id) {
    var node = el(id);
    if (!node) return 0;
    var n = parseInt(String(node.value).replace(/[^0-9-]/g, ''), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function numVal(id) {
    var node = el(id);
    if (!node) return 0;
    var n = parseFloat(String(node.value).replace(/[^0-9]/g, ''));
    return isNaN(n) || n < 0 ? 0 : Math.round(n);
  }

  function strVal(id) {
    var node = el(id);
    return node ? String(node.value || '') : '';
  }

  function isChecked(id) {
    var node = el(id);
    return !!(node && node.checked);
  }

  // Rp + NBSP (U+00A0) supaya "-Rp 1.000" tak pernah patah baris. WAJIB.
  function formatRupiahNoWrap(amount) {
    var n = Number(amount);
    if (!isFinite(n)) n = 0;
    var rounded = Math.round(Math.abs(n));
    return (n < 0 ? '-Rp\u00A0' : 'Rp\u00A0') + FMT.format(rounded);
  }

  function plainNumber(n) { return FMT.format(Math.round(Number(n) || 0)); }

  // ---------- Analytics ringan tanpa PII (PS-007, 0 KV write) ----------
  // Event names: calc_completed, mode_switched_pkwt, offer_gap_checked.
  // Props hanya string pendek aman (mode/status) — tanpa gaji/NIK/email.
  function trackEvent(name, props) {
    try {
      var g = typeof globalThis !== 'undefined' ? globalThis : window;
      if (!g.__psEvents || !Array.isArray(g.__psEvents)) g.__psEvents = [];
      var safeProps = {};
      if (props && typeof props === 'object') {
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
          var v = props[keys[i]];
          if (typeof v === 'boolean') safeProps[keys[i]] = v;
          else if (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 99999 && v % 1 === 0) safeProps[keys[i]] = v;
          else if (typeof v === 'string' && v.length > 0 && v.length <= 64) safeProps[keys[i]] = v;
        }
      }
      g.__psEvents.push({ name: String(name), props: safeProps });
      if (typeof g.gtag === 'function') {
        try { g.gtag('event', String(name), safeProps); } catch (err) { /* abaikan */ }
      }
      if (typeof g.plausible === 'function') {
        try { g.plausible(String(name), { props: safeProps }); } catch (err) { /* abaikan */ }
      }
    } catch (err) { /* analitik tidak boleh memecahkan alur utama */ }
  }

  // Satu event per sesi perhitungan: emit saat hasil pertama kali muncul
  // dari input user (bukan render awal dari localStorage), re-arm saat reset.
  var analyticsState = { calcEmitted: false, lastGapStatus: null };

  function mode() { return isChecked('mode-pkwt') ? 'PKWT' : 'PKWTT'; }

  function scenarioNeedsUangPisah() {
    return !!UANG_PISAH_SCENARIOS[strVal('select-phk-reason')];
  }

  function setText(node, text) { if (node) node.textContent = text; }

  function toggleHidden(node, hidden) {
    if (!node) return;
    if (hidden) node.classList.add('hidden');
    else node.classList.remove('hidden');
  }


  // ---------- Bangun input untuk engine (komp verbatim PS-002) ----------
  function buildEngineInput() {
    var m = mode();
    var wage = intVal('input-base-salary') + intVal('input-fixed-allowance');
    if (m === 'PKWT') {
      return {
        employmentType: 'PKWT',
        monthlyWage: wage,
        monthsWorked: numVal('input-pkwt-months'),
        remainingMonths: numVal('input-pkwt-remaining'),
        isEarlyTermination: isChecked('toggle-pkwt-early'),
        phkScenario: strVal('select-phk-reason') || 'RESIGN',
        companyOffer: intVal('input-company-offer')
      };
    }
    return {
      employmentType: 'PKWTT',
      monthlyWage: wage,
      years: numVal('input-years'),
      months: numVal('input-months'),
      phkScenario: strVal('select-phk-reason') || 'EFISIENSI_RUGI',
      unusedLeaveDays: numVal('input-unused-leave'),
      transportCost: intVal('input-transport-uph'),
      otherUph: 0,
      uangPisah: intVal('input-uang-pisah'),
      companyOffer: intVal('input-company-offer')
    };
  }

  // ---------- Render breakdown ----------
  function appendBreakdownRow(listEl, label, amount, isBold) {
    var row = document.createElement('div');
    row.className = 'breakdown-row' + (isBold ? ' breakdown-row-total' : '');
    var lab = document.createElement('span');
    lab.className = 'row-label';
    lab.textContent = label;
    var val = document.createElement('span');
    val.className = 'money-value';
    val.textContent = formatRupiahNoWrap(amount);
    row.appendChild(lab);
    row.appendChild(val);
    listEl.appendChild(row);
  }

  function renderCalculation() {
    var input = buildEngineInput();
    var engine = window.PesangonEngine;
    var res;
    try {
      res = engine.calculateFullSeverance(input);
    } catch (err) {
      setText(el('result-gross-total'), formatRupiahNoWrap(0));
      setText(el('result-tax-total'), formatRupiahNoWrap(0));
      setText(el('result-net-severance'), formatRupiahNoWrap(0));
      return;
    }

    // Hero: Net, Gross, Pajak (PRD §5: "Total Bersih Diterima" = hero)
    setText(el('result-gross-total'), formatRupiahNoWrap(res.grossTotal));
    setText(el('result-tax-total'), formatRupiahNoWrap(res.tax && res.tax.total || 0));
    setText(el('result-net-severance'), formatRupiahNoWrap(res.netTotal));

    // Breakdown rows
    var list = el('result-breakdown-list');
    if (list) {
      list.innerHTML = '';
      var c = res.components || {};
      var m = mode();
      if (m === 'PKWT') {
        appendBreakdownRow(list, LABELS.kompensasiPKWT, c.kompensasiPKWT || 0, false);
        appendBreakdownRow(list, LABELS.gantiRugiPKWT, c.gantiRugiPKWT || 0, false);
      } else {
        if (c.up > 0) { var d = res.detail || {}; appendBreakdownRow(list, LABELS.up + ' — ' + (d.upMultiplier || 0) + ' bulan × ' + (d.scenarioUpMultiplier != null ? String(d.scenarioUpMultiplier).replace('.', ',') : '1'), c.up, false); }
        if (c.upmk > 0) { var d2 = res.detail || {}; appendBreakdownRow(list, LABELS.upmk + ' — ' + (d2.upmkMultiplier || 0) + ' bulan × ' + (d2.scenarioUpmkMultiplier != null ? String(d2.scenarioUpmkMultiplier).replace('.', ',') : '1'), c.upmk, false); }
        if (c.uph > 0) appendBreakdownRow(list, LABELS.uph, c.uph, false);
        if (c.uangPisah > 0) appendBreakdownRow(list, LABELS.uangPisah, c.uangPisah, false);
      }
    }

    renderGapCard(res);
  }

  // ---------- Gap card (Tawaran vs Hak Normatif, PRD §3) ----------
  function renderGapCard(res) {
    var card = el('offer-gap-card');
    if (!card) return;
    var gap = res && res.gap;
    if (!gap) {
      toggleHidden(card, true);
      analyticsState.lastGapStatus = null;
      return;
    }
    toggleHidden(card, false);
    var statusEl = card.querySelector('[data-gap-status]');
    var diffEl = card.querySelector('[data-gap-diff]');
    var pctEl = card.querySelector('[data-gap-percent]');
    var statusText = { SESUAI: 'Sesuai Hak Normatif', KURANG_BAYAR: 'Kurang Bayar', LEBIH_TINGGI: 'Lebih Tinggi dari Hak Normatif' }[gap.status] || gap.status;
    setText(statusEl, statusText);
    setText(diffEl, formatRupiahNoWrap(gap.difference));
    var pct = String(gap.percent).replace('.', ',');
    setText(pctEl, (gap.percent > 0 ? '+' : '') + pct + '% vs hak normatif');

    // PS-007 analytics: offer_gap_checked (hanya saat status berubah, tanpa nominal)
    if (analyticsState.lastGapStatus !== gap.status) {
      analyticsState.lastGapStatus = gap.status;
      trackEvent('offer_gap_checked', { status: String(gap.status), mode: mode() });
    }
  }

  // ---------- Visibilitas field dinamis ----------
  function updateFieldVisibility() {
    var m = mode();
    var isPkwt = m === 'PKWT';
    toggleHidden(el('pkwt-fields'), !isPkwt);
    toggleHidden(el('pkwtt-fields'), isPkwt);
    var upNode = el('uang-pisah-field');
    if (upNode) toggleHidden(upNode, !scenarioNeedsUangPisah());
    var remField = el('pkwt-remaining-field');
    if (remField) toggleHidden(remField, !isChecked('toggle-pkwt-early'));
    var earlyNote = el('pkwt-early-note');
    if (earlyNote) toggleHidden(earlyNote, !isChecked('toggle-pkwt-early'));
  }

  // ---------- localStorage ps_last_calc_v1 (PRD "Simpan Lokal") ----------
  function saveToLocalStorage() {
    try {
      var data = { mode: mode(), savedAt: new Date().toISOString() };
      var ids = ['input-base-salary','input-fixed-allowance','input-years','input-months',
        'input-unused-leave','input-transport-uph','input-uang-pisah',
        'input-pkwt-months','input-pkwt-remaining','input-company-offer'];
      for (var i = 0; i < ids.length; i++) {
        var node = el(ids[i]);
        if (node) data[ids[i]] = node.value;
      }
      data['select-phk-reason'] = strVal('select-phk-reason');
      data['toggle-pkwt-early'] = isChecked('toggle-pkwt-early');
      data['mode-pkwt'] = isChecked('mode-pkwt');
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) { /* storage penuh/diblokir: abaikan, fitur tetap jalan */ }
  }

  function loadFromLocalStorage() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (data['mode-pkwt']) {
        var pkwt = el('mode-pkwt');
        if (pkwt) pkwt.checked = true;
      }
      var ids = ['input-base-salary','input-fixed-allowance','input-years','input-months',
        'input-unused-leave','input-transport-uph','input-uang-pisah',
        'input-pkwt-months','input-pkwt-remaining','input-company-offer'];
      for (var i = 0; i < ids.length; i++) {
        var node = el(ids[i]);
        if (node && typeof data[ids[i]] !== 'undefined') node.value = data[ids[i]];
      }
      var sel = el('select-phk-reason');
      if (sel && data['select-phk-reason']) sel.value = data['select-phk-reason'];
      var tg = el('toggle-pkwt-early');
      if (tg) tg.checked = !!data['toggle-pkwt-early'];
      return true;
    } catch (err) { return false; }
  }

  function clearSavedState() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) {}
  }

  // ---------- Salin Ringkasan (PRD §3: teks rapi siap tempel) ----------
  function copySummaryToClipboard() {
    var lines = [];
    lines.push('Estimasi Pesangon - PesangonCVKita');
    lines.push('Mode: ' + (mode() === 'PKWT' ? 'PKWT' : 'PKWTT (Tetap)'));
    var wage = intVal('input-base-salary') + intVal('input-fixed-allowance');
    lines.push('Upah (gaji pokok + tunjangan tetap): ' + formatRupiahNoWrap(wage));
    if (mode() === 'PKWT') {
      lines.push('Masa kerja: ' + numVal('input-pkwt-months') + ' bulan');
      if (isChecked('toggle-pkwt-early')) lines.push('Diputus sebelum kontrak berakhir (sisa ' + numVal('input-pkwt-remaining') + ' bulan)');
    } else {
      lines.push('Masa kerja: ' + numVal('input-years') + ' tahun ' + numVal('input-months') + ' bulan');
      lines.push('Alasan PHK: ' + (strVal('select-phk-reason') || '-'));
    }
    var list = el('result-breakdown-list');
    if (list) {
      var rows = list.querySelectorAll('.breakdown-row');
      for (var i = 0; i < rows.length; i++) {
        var lab = rows[i].querySelector('.row-label');
        var val = rows[i].querySelector('.money-value');
        if (lab && val) lines.push(lab.textContent + ': ' + val.textContent);
      }
    }
    var gross = el('result-gross-total');
    var tax = el('result-tax-total');
    var net = el('result-net-severance');
    if (gross) lines.push('Total Bruto: ' + gross.textContent);
    if (tax) lines.push('PPh 21 Final: ' + tax.textContent);
    if (net) lines.push('Total Bersih: ' + net.textContent);
    lines.push('(Estimasi simulasi, bukan nasihat hukum. Pemberi kerja wajib menerbitkan Bukti Potong PPh 21 Final meski pajak Rp 0.)');
    var text = lines.join('\n');

    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  // ---------- initCalculator ----------
  function initCalculator() {
    cacheEls();
    loadFromLocalStorage();
    updateFieldVisibility();
    renderCalculation();

    var inputs = ['input-base-salary','input-fixed-allowance','input-years','input-months',
      'input-unused-leave','input-transport-uph','input-uang-pisah',
      'input-pkwt-months','input-pkwt-remaining','input-company-offer'];
    for (var i = 0; i < inputs.length; i++) {
      var node = el(inputs[i]);
      if (node) node.addEventListener('input', onInputChanged);
    }
    var sel = el('select-phk-reason');
    if (sel) sel.addEventListener('change', onInputChanged);
    var tg = el('toggle-pkwt-early');
    if (tg) tg.addEventListener('change', onInputChanged);
    var mPkwtt = el('mode-pkwtt');
    var mPkwt = el('mode-pkwt');
    if (mPkwtt) mPkwtt.addEventListener('change', onModeChanged);
    if (mPkwt) mPkwt.addEventListener('change', onModeChanged);
    var btnCopy = el('btn-copy-summary');
    if (btnCopy) btnCopy.addEventListener('click', copySummaryToClipboard);
    var btnReset = el('btn-reset-form');
    if (btnReset) btnReset.addEventListener('click', resetForm);
  }

  function onInputChanged() {
    updateFieldVisibility();
    renderCalculation();
    saveToLocalStorage();
    // PS-007 analytics: calc_completed — sekali per sesi perhitungan (re-arm via reset).
    if (!analyticsState.calcEmitted) {
      analyticsState.calcEmitted = true;
      trackEvent('calc_completed', { mode: mode() });
    }
  }

  function onModeChanged() {
    updateFieldVisibility();
    renderCalculation();
    saveToLocalStorage();
    // PS-007 analytics: mode_switched_pkwt — hanya saat pindah ke PKWT.
    if (mode() === 'PKWT') {
      trackEvent('mode_switched_pkwt', { mode: 'PKWT' });
    }
  }

  function resetForm() {
    var ids = ['input-base-salary','input-fixed-allowance','input-years','input-months',
      'input-unused-leave','input-transport-uph','input-uang-pisah',
      'input-pkwt-months','input-pkwt-remaining','input-company-offer'];
    for (var i = 0; i < ids.length; i++) {
      var node = el(ids[i]);
      if (node) node.value = '';
    }
    var sel = el('select-phk-reason');
    if (sel) sel.value = 'EFISIENSI_RUGI';
    var tg = el('toggle-pkwt-early');
    if (tg) tg.checked = false;
    var mPkwtt = el('mode-pkwtt');
    if (mPkwtt) mPkwtt.checked = true;
    // PS-007 analytics: reset meng-arm ulang calc_completed sesi baru.
    analyticsState.calcEmitted = false;
    analyticsState.lastGapStatus = null;
    clearSavedState();
    updateFieldVisibility();
    renderCalculation();
  }

  // ---------- Bootstrap ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalculator);
  } else {
    initCalculator();
  }
})();
