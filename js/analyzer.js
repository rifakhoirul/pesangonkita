/**
 * PesangonCVKita — AI Bedah Surat PHK/Resign (PS-004 + PS-007)
 * Fitur input dokumen (PDF lokal via PDF.js), penyamaran PII lokal,
 * Free Teaser & Analisis Pro (kontrak Spec_Summary PS-004):
 *  - Ekstraksi PDF 100% di browser (PDF.js cdnjs 3.11.174, lazy-load saat
 *    file dipilih) — DILARANG mengunggah file binary PDF ke server.
 *  - DILARANG menyimpan teks surat ke localStorage (hanya kode lisensi).
 *  - Tombol analisis WAJIB disabled sampai checkbox UU PDP dicentang
 *    dan teks >= 30 karakter (sinkron real-time).
 *  - API_BASE konstanta (Next_Instruction PS-004/PS-007: https://api.cvkita.id)
 *    agar endpoint /api/ps/* bisa di-mock Playwright.
 * PS-007 (paywall, lisensi, analytics):
 *  - startMidtransCheckout(): email #input-buyer-email, POST /api/ps/checkout,
 *    Midtrans Snap (window.snap.pay) atau fallback redirect.
 *  - activateLicenseCode(code): validasi regex + GET /api/ps/license-status,
 *    simpan ke localStorage ps_license_code_v1 (migrasi 1x dari ps_license_v1).
 *  - renderProReport(data) + printProReport() (@media print bersih).
 *  - trackEvent(name, props): ringan, 0 KV write, 0 network call ke Worker,
 *    TANPA PII — catat ke window.__psEvents + forward gtag/plausible.
 * Format UMD: browser (window.PesangonAnalyzer) + Node (Vitest).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.PesangonAnalyzer = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var API_BASE = 'https://api.cvkita.id';
  var LICENSE_REGEX = /^PS-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var LICENSE_STORAGE_KEY = 'ps_license_code_v1';
  var LICENSE_LEGACY_KEY = 'ps_license_v1';
  var MIN_TEXT_LENGTH = 30;
  var MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB
  var PDFJS_VERSION = '3.11.174';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.min.js';
  var PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.js';

  var MSG = {
    CONSENT_REQUIRED: 'Centang dulu persetujuan UU PDP di atas — analisis tidak boleh berjalan tanpa persetujuan eksplisit.',
    TEXT_TOO_SHORT: 'Teks surat minimal 30 karakter supaya AI bisa membaca konteks dokumen.',
    NO_LICENSE: 'Kode lisensi Pro belum terpasang. Masukkan kode berformat PS-XXXX-XXXX atau beli lisensi di kartu pembayaran (fokus diarahkan ke bawah).',
    PRO_FAILED: 'Analisis Pro gagal dijalankan (gangguan jaringan/server atau lisensi tidak valid). Coba lagi beberapa saat; kuota hanya terpotong setelah analisis sukses.',
    TEASER_FAILED: 'Teaser gratis sedang tidak tersedia (gangguan jaringan/server). Coba lagi beberapa saat, atau tempel teks surat secara manual.',
    LICENSE_INVALID: 'Format kode lisensi tidak valid. Gunakan format PS-XXXX-XXXX (contoh: PS-AB12-CD34).',
    LICENSE_OK: 'Lisensi terpasang dan aktif — kuota sudah diverifikasi ke server.',
    LICENSE_NOT_FOUND: 'Kode lisensi tidak ditemukan atau sudah tidak aktif. Periksa kembali email dari kode@cvkita.id, lalu coba lagi.',
    LICENSE_CHECK_FAILED: 'Gagal memeriksa lisensi ke server (gangguan jaringan). Coba lagi beberapa saat.',
    BUY_EMAIL_INVALID: 'Email belum valid. Masukkan email aktif — kode lisensi dikirim ke email ini.',
    BUY_FAILED: 'Checkout gagal disiapkan (gangguan server/payment gateway). Coba lagi beberapa saat.',
    BUY_NETWORK: 'Checkout gagal dijalankan (gangguan jaringan). Coba lagi beberapa saat.',
    BUY_SNAP: 'Membuka Midtrans Snap — selesaikan pembayaran di jendela yang muncul.',
    BUY_REDIRECT: 'Mengarahkan ke halaman pembayaran Midtrans...',
    BUY_INCOMPLETE: 'Respon pembayaran tidak lengkap. Coba lagi beberapa saat.',
    MASK_DONE: 'Data pribadi (NIK, email, no HP, NPWP) disamarkan secara lokal di browser. Tidak ada data yang dikirim.',
    PDF_READING: 'Membaca PDF di browser...',
    PDF_SCANNED: 'PDF ini tampaknya hasil scan gambar tanpa teks. Ketik atau tempel teks surat secara manual.',
    NOT_PDF: 'File harus berformat PDF (.pdf). Coba pilih ulang file yang benar.',
    PDF_TOO_LARGE: 'Ukuran PDF maksimal 5 MB. Kompres atau pecah file, lalu coba lagi.',
    FILE_INVALID: 'File tidak terbaca. Coba pilih ulang file PDF kamu.'
  };

  function byId(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function globalObj() {
    if (typeof globalThis !== 'undefined') return globalThis;
    return root;
  }

  /* ---------- Penyamaran PII (pure, deterministik) ---------- */
  // Urutan penting: NIK (16 digit) duluan agar tidak tertelan pola no HP.
  function maskBasicPII(text) {
    if (typeof text !== 'string') return '';
    var out = text
      // NIK: tepat 16 digit berdiri sendiri
      .replace(/(^|[^0-9])(\d{16})(?=[^0-9]|$)/g, '$1[NIK_DISAMARKAN]')
      // NPWP berformat 01.234.567.8-901.345
      .replace(/(^|[^0-9])(\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3})(?=[^0-9]|$)/g, '$1[NPWP_DISAMARKAN]')
      // Email
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL_DISAMARKAN]')
      // No HP Indonesia: 08... / +628... / 628...
      .replace(/(^|[^0-9+])((?:\+62|62|0)8\d{7,11})(?=[^0-9]|$)/g, '$1[NO_HP_DISAMARKAN]');
    return out;
  }

  /* ---------- Analytics ringan tanpa PII (PS-007) ---------- */
  // 0 KV write, 0 network call ke Worker. Hanya props aman yang disimpan:
  // boolean, integer kecil (0-99999), string pendek tanpa pola PII.
  // Gaji, teks surat, NIK, email, kode lisensi DILARANG masuk payload.
  function sanitizeEventProps(props) {
    var out = {};
    if (!props || typeof props !== 'object') return out;
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = props[key];
      if (val == null) continue;
      if (typeof val === 'boolean') { out[key] = val; continue; }
      if (typeof val === 'number' && isFinite(val) && val >= 0 && val <= 99999 && val % 1 === 0) {
        out[key] = val;
        continue;
      }
      if (typeof val === 'string' && val.length > 0 && val.length <= 64) {
        if (val.indexOf('@') !== -1) continue;                       // email
        if (/PS-[A-Z0-9]{4}-[A-Z0-9]{4}/i.test(val)) continue;       // kode lisensi
        if (/\d{7,}/.test(val)) continue;                            // NIK / no HP / nominal
        out[key] = val;
      }
      // objek/array/nilai panjang: dibuang diam-diam (bukan tipe props analitik)
    }
    return out;
  }

  function trackEvent(name, props) {
    try {
      var g = globalObj();
      if (!g.__psEvents || !Array.isArray(g.__psEvents)) g.__psEvents = [];
      var safeProps = sanitizeEventProps(props);
      g.__psEvents.push({ name: String(name), props: safeProps });
      if (typeof g.gtag === 'function') {
        try { g.gtag('event', String(name), safeProps); } catch (err) { /* abaikan */ }
      }
      if (typeof g.plausible === 'function') {
        try { g.plausible(String(name), { props: safeProps }); } catch (err) { /* abaikan */ }
      }
    } catch (err) {
      // analitik tidak boleh pernah memecahkan alur utama
    }
  }

  /* ---------- Validasi & ekstraksi PDF lokal (PDF.js) ---------- */
  function validatePdfFile(file) {
    if (!file || typeof file !== 'object') return { ok: false, error: MSG.FILE_INVALID };
    var isPdfType = file.type === 'application/pdf';
    var isPdfName = /\.pdf$/i.test(String(file.name || ''));
    if (!isPdfType && !isPdfName) return { ok: false, error: MSG.NOT_PDF };
    if (typeof file.size === 'number' && file.size > MAX_PDF_BYTES) {
      return { ok: false, error: MSG.PDF_TOO_LARGE };
    }
    return { ok: true };
  }

  var pdfJsPromise = null;
  function loadPdfJs() {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('PDF.js hanya tersedia di browser.'));
    }
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (!pdfJsPromise) {
      pdfJsPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = PDFJS_URL;
        script.onload = function () {
          if (root.pdfjsLib) {
            root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
            resolve(root.pdfjsLib);
          } else {
            pdfJsPromise = null;
            reject(new Error(MSG.TEASER_FAILED));
          }
        };
        script.onerror = function () {
          pdfJsPromise = null;
          reject(new Error('Gagal memuat pembaca PDF. Periksa koneksi internet, atau tempel teks surat secara manual.'));
        };
        document.head.appendChild(script);
      });
    }
    return pdfJsPromise;
  }

  async function extractPdfTextClientSide(file) {
    var check = validatePdfFile(file);
    if (!check.ok) throw new Error(check.error);
    var pdfjsLib = await loadPdfJs();
    var buffer = await file.arrayBuffer();
    var doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    var pageTexts = [];
    for (var pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      var page = await doc.getPage(pageNo);
      var content = await page.getTextContent();
      pageTexts.push(
        content.items
          .map(function (item) { return item.str; })
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .trim()
      );
    }
    await doc.destroy();
    var text = pageTexts.join('\n\n').trim();
    if (!text) throw new Error(MSG.PDF_SCANNED);
    return text;
  }

  /* ---------- State & helper UI ---------- */
  function consentChecked() {
    var box = byId('checkbox-pdp-consent');
    return !!(box && box.checked);
  }

  function letterText() {
    var ta = byId('textarea-letter-text');
    return ta ? String(ta.value || '') : '';
  }

  function setStatus(id, message, kind) {
    var elx = byId(id);
    if (!elx) return;
    elx.textContent = message || '';
    elx.classList.remove('error', 'ok');
    if (kind) elx.classList.add(kind);
  }

  function getStoredLicense() {
    try {
      var code = root.localStorage ? root.localStorage.getItem(LICENSE_STORAGE_KEY) : null;
      return code ? String(code).trim().toUpperCase() : '';
    } catch (err) {
      return '';
    }
  }

  function getLicenseCode() {
    var stored = getStoredLicense();
    if (LICENSE_REGEX.test(stored)) return stored;
    var input = byId('input-license-code');
    var typed = input ? String(input.value || '').trim().toUpperCase() : '';
    return LICENSE_REGEX.test(typed) ? typed : '';
  }

  // Migrasi 1x dari key lama ps_license_v1 -> ps_license_code_v1 (PS-007).
  function migrateLicenseKey() {
    try {
      var ls = root.localStorage;
      if (!ls || typeof ls.getItem !== 'function') return false;
      var oldVal = ls.getItem(LICENSE_LEGACY_KEY);
      if (!oldVal) return false;
      var normalized = String(oldVal).trim().toUpperCase();
      if (!LICENSE_REGEX.test(normalized)) {
        ls.removeItem(LICENSE_LEGACY_KEY);
        return false;
      }
      ls.setItem(LICENSE_STORAGE_KEY, normalized);
      ls.removeItem(LICENSE_LEGACY_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  function updateRunButtons() {
    var ready = consentChecked() && letterText().trim().length >= MIN_TEXT_LENGTH;
    ['btn-run-teaser', 'btn-run-pro'].forEach(function (id) {
      var btn = byId(id);
      if (btn) btn.disabled = !ready;
    });
  }

  function guardAnalysis(card, statusId) {
    if (!consentChecked()) {
      setStatus(statusId, MSG.CONSENT_REQUIRED, 'error');
      return false;
    }
    if (letterText().trim().length < MIN_TEXT_LENGTH) {
      setStatus(statusId, MSG.TEXT_TOO_SHORT, 'error');
      return false;
    }
    setStatus(statusId, '', null);
    return true;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderError(card, title, message) {
    card.textContent = '';
    card.appendChild(el('h2', null, title));
    card.appendChild(el('p', 'analyzer-status error', message));
    card.classList.remove('hidden');
  }

  function moneySpan(text) {
    return el('span', 'money-value', text);
  }

  function appendList(container, heading, items, ordered) {
    if (!Array.isArray(items) || !items.length) return;
    if (heading) container.appendChild(el('h3', null, heading));
    var list = el(ordered ? 'ol' : 'ul', 'result-list');
    items.slice(0, 10).forEach(function (item) {
      list.appendChild(el('li', null, String(item)));
    });
    container.appendChild(list);
  }

  function appendScore(container, score) {
    if (score == null || isNaN(Number(score))) return;
    container.appendChild(el('p', 'result-score', 'Skor kelengkapan komponen hak: ' + Number(score) + '/100'));
  }

  function appendDocType(container, docType) {
    if (docType == null || docType === '') return;
    container.appendChild(el('p', 'result-doc-type', 'Jenis dokumen terdeteksi: ' + String(docType)));
  }

  function setQuotaBadge(text) {
    var badge = byId('license-quota-badge');
    if (badge) badge.textContent = text;
  }

  /* ---------- Lisensi: aktivasi & sinkron kuota (PS-007) ---------- */
  async function activateLicenseCode(code) {
    var normalized = String(code || '').trim().toUpperCase();
    if (!LICENSE_REGEX.test(normalized)) {
      return { ok: false, error: MSG.LICENSE_INVALID };
    }
    try {
      var res = await fetch(API_BASE + '/api/ps/license-status?code=' + encodeURIComponent(normalized), {
        method: 'GET'
      });
      var data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (!res.ok || !data || data.valid !== true) {
        return { ok: false, error: MSG.LICENSE_NOT_FOUND };
      }
      var quota = Number(data.quota);
      var safeQuota = isNaN(quota) ? 0 : quota;
      try { root.localStorage.setItem(LICENSE_STORAGE_KEY, normalized); } catch (err) {
        // localStorage bisa diblokir (private mode) — lisensi tetap dipakai sesi ini.
      }
      setQuotaBadge('Lisensi aktif: ' + normalized + ' · Sisa kuota Pro: ' + safeQuota + ' analisis');
      trackEvent('license_activated', { valid: true, quota: safeQuota });
      return { ok: true, code: normalized, quota: safeQuota, status: data.status || 'active' };
    } catch (err) {
      return { ok: false, error: MSG.LICENSE_CHECK_FAILED };
    }
  }

  // Auto-sync kuota saat halaman dimuat jika ps_license_code_v1 sudah ada.
  async function syncLicenseQuota() {
    var code = getStoredLicense();
    if (!LICENSE_REGEX.test(code)) return { ok: false, error: MSG.NO_LICENSE };
    try {
      var res = await fetch(API_BASE + '/api/ps/license-status?code=' + encodeURIComponent(code), {
        method: 'GET'
      });
      var data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (res.ok && data && data.valid === true) {
        var quota = Number(data.quota);
        var safeQuota = isNaN(quota) ? 0 : quota;
        setQuotaBadge('Lisensi aktif: ' + code + ' · Sisa kuota Pro: ' + safeQuota + ' analisis');
        return { ok: true, quota: safeQuota };
      }
      setQuotaBadge('Lisensi tersimpan: ' + code + ' (status belum terverifikasi server)');
      return { ok: false, error: MSG.LICENSE_NOT_FOUND };
    } catch (err) {
      return { ok: false, error: MSG.LICENSE_CHECK_FAILED };
    }
  }

  /* ---------- Checkout Midtrans Snap (PS-007) ---------- */
  async function startMidtransCheckout() {
    var input = byId('input-buyer-email');
    var statusId = 'buy-status';
    if (!input) return { ok: false, error: 'Form pembayaran tidak ditemukan.' };
    var email = String(input.value || '').trim();
    if (!EMAIL_REGEX.test(email)) {
      setStatus(statusId, MSG.BUY_EMAIL_INVALID, 'error');
      return { ok: false, error: MSG.BUY_EMAIL_INVALID };
    }

    trackEvent('checkout_clicked', { source: 'paywall' });

    var btn = byId('btn-buy-pro');
    var originalLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyiapkan pembayaran...';
    }
    try {
      var res = await fetch(API_BASE + '/api/ps/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (!res.ok || !data || data.ok !== true) {
        var msg = (data && data.error) ? String(data.error) : MSG.BUY_FAILED;
        setStatus(statusId, msg, 'error');
        return { ok: false, error: msg };
      }
      var snapToken = typeof data.snapToken === 'string' ? data.snapToken : '';
      var redirectUrl = typeof data.redirectUrl === 'string' ? data.redirectUrl : '';
      if (snapToken && root.snap && typeof root.snap.pay === 'function') {
        setStatus(statusId, MSG.BUY_SNAP, 'ok');
        try { root.snap.pay(snapToken); } catch (err) { /* fallback di bawah */ }
        return { ok: true, orderId: data.orderId, mode: 'snap' };
      }
      if (redirectUrl) {
        setStatus(statusId, MSG.BUY_REDIRECT, 'ok');
        if (root.location && typeof root.location.assign === 'function') {
          root.location.assign(redirectUrl);
        } else if (root.location) {
          root.location.href = redirectUrl;
        }
        return { ok: true, orderId: data.orderId, mode: 'redirect' };
      }
      setStatus(statusId, MSG.BUY_INCOMPLETE, 'error');
      return { ok: false, error: MSG.BUY_INCOMPLETE };
    } catch (err) {
      setStatus(statusId, MSG.BUY_NETWORK, 'error');
      return { ok: false, error: MSG.BUY_NETWORK };
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }
  }

  /* ---------- Free Teaser (endpoint /api/ps/preview-letter) ---------- */
  async function runFreeTeaser() {
    var card = byId('teaser-result-card');
    var btn = byId('btn-run-teaser');
    var statusId = 'analyzer-status';
    if (!card || !btn) return;
    if (!guardAnalysis(card, statusId)) return;

    trackEvent('teaser_started', { source: 'analyzer' });

    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menganalisis...';
    card.textContent = '';
    card.appendChild(el('p', 'analyzer-status', 'Menganalisis teaser gratis...'));
    card.classList.remove('hidden');

    try {
      var res = await fetch(API_BASE + '/api/ps/preview-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letterText: letterText() })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      card.textContent = '';
      card.appendChild(el('h2', null, 'Hasil Teaser Gratis'));
      appendDocType(card, data && data.docType);
      card.appendChild(el('p', 'result-sub-line', 'Indikasi awal red flag (maksimal 3 poin):'));
      var flags = Array.isArray(data && data.redFlagsPreview) ? data.redFlagsPreview.slice(0, 3) : [];
      if (flags.length) {
        var ul = el('ul', 'result-list');
        flags.forEach(function (flag) { ul.appendChild(el('li', null, String(flag))); });
        card.appendChild(ul);
      } else {
        card.appendChild(el('p', 'result-list-empty', 'Tidak ada indikasi awal yang dikembalikan untuk teks ini.'));
      }
      appendScore(card, data ? data.completenessScore : null);
      var upsell = el('p', 'result-upsell', 'Analisis lengkap (audit red flag klausul, verifikasi angka PP 35/2021, 3 skrip balasan HR) tersedia dengan lisensi Pro ');
      upsell.appendChild(moneySpan('Rp\u00A029.000'));
      upsell.appendChild(document.createTextNode(' sekali bayar.'));
      card.appendChild(upsell);
    } catch (err) {
      renderError(card, 'Hasil Teaser Gratis', MSG.TEASER_FAILED);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
      updateRunButtons();
    }
  }

  /* ---------- Analisis Pro: render hasil (PS-007 renderProReport) ---------- */
  function copyTextToClipboard(text, btn) {
    function flashCopied() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = 'Tersalin!';
      root.setTimeout(function () { btn.textContent = old; }, 1500);
    }
    try {
      if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
        root.navigator.clipboard.writeText(text).then(flashCopied, function () {
          fallbackCopyText(text);
          flashCopied();
        });
        return;
      }
    } catch (err) { /* lanjut ke fallback */ }
    fallbackCopyText(text);
    flashCopied();
  }

  function fallbackCopyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (err) { /* salin gagal — tidak fatal */ }
  }

  function renderProReport(data) {
    var card = byId('pro-result-card');
    if (!card) return null;
    card.textContent = '';
    card.appendChild(el('h2', null, 'Hasil Analisis Pro'));
    appendDocType(card, data && data.docType);
    appendScore(card, data ? data.completenessScore : null);
    appendList(card, 'Red flag klausul yang terdeteksi:', data && data.redFlags, false);

    var scripts = Array.isArray(data && data.hrScripts) ? data.hrScripts : [];
    if (scripts.length) {
      card.appendChild(el('h3', null, '3 Skrip Balasan HR (siap pakai):'));
      var wrap = el('div', 'hr-scripts');
      scripts.slice(0, 5).forEach(function (script, idx) {
        var item = el('div', 'hr-script-item');
        item.appendChild(el('p', 'hr-script-text', String(script)));
        var copyBtn = el('button', 'btn btn-secondary btn-copy-script', 'Salin Skrip ' + (idx + 1));
        copyBtn.type = 'button';
        copyBtn.setAttribute('data-testid', 'btn-copy-script-' + (idx + 1));
        copyBtn.addEventListener('click', function () {
          copyTextToClipboard(String(script), copyBtn);
        });
        item.appendChild(copyBtn);
        wrap.appendChild(item);
      });
      card.appendChild(wrap);
    }

    appendList(card, 'Checklist sebelum tanda tangan:', data && data.checklist, false);

    if (data && data.quotaRemaining != null && !isNaN(Number(data.quotaRemaining))) {
      setQuotaBadge('Lisensi aktif · Sisa kuota Pro: ' + Number(data.quotaRemaining) + ' analisis');
    }

    var actions = el('div', 'action-row');
    var printBtn = el('button', 'btn', 'Cetak / Simpan PDF');
    printBtn.type = 'button';
    printBtn.id = 'btn-print-report';
    printBtn.setAttribute('data-testid', 'btn-print-report');
    printBtn.addEventListener('click', printProReport);
    actions.appendChild(printBtn);
    card.appendChild(actions);

    // Stempel tanggal cetak (tampil saat print/PDF — CSS @media print PS-007)
    card.appendChild(el('p', 'print-timestamp',
      'Dicetak dari PesangonCVKita (pesangon.cvkita.id) pada ' + new Date().toISOString().slice(0, 10)));

    card.appendChild(el('p', 'result-disclaimer',
      'Hasil analisis adalah alat bantu edukasi ketenagakerjaan, bukan nasihat hukum resmi dan bukan pengganti konsultan hukum/advokat maupun mediator Disnaker.'));
    card.classList.remove('hidden');
    return card;
  }

  function printProReport() {
    var g = globalObj();
    if (g && typeof g.print === 'function') {
      g.print();
      return true;
    }
    if (root && typeof root.print === 'function') {
      root.print();
      return true;
    }
    return false;
  }

  /* ---------- Analisis Pro (endpoint /api/ps/analyze-letter) ---------- */
  async function runProAnalysis() {
    var card = byId('pro-result-card');
    var btn = byId('btn-run-pro');
    var statusId = 'analyzer-status';
    if (!card || !btn) return;
    if (!guardAnalysis(card, statusId)) return;

    var licenseCode = getLicenseCode();
    if (!licenseCode) {
      setStatus(statusId, MSG.NO_LICENSE, 'error');
      var paywall = byId('paywall-card');
      if (paywall) {
        paywall.classList.add('paywall-highlight');
        paywall.focus();
        if (paywall.scrollIntoView) paywall.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menganalisis (1 kuota)...';
    card.textContent = '';
    card.appendChild(el('p', 'analyzer-status', 'Menganalisis surat (Pro, 1 kuota)...'));
    card.classList.remove('hidden');

    try {
      var res = await fetch(API_BASE + '/api/ps/analyze-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letterText: letterText(), licenseCode: licenseCode })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      renderProReport(data);
    } catch (err) {
      renderError(card, 'Hasil Analisis Pro', MSG.PRO_FAILED);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
      updateRunButtons();
    }
  }

  /* ---------- Aksi lisensi & pembelian ---------- */
  async function onActivateLicense() {
    var input = byId('input-license-code');
    if (!input) return;
    var code = String(input.value || '').trim().toUpperCase();
    if (!LICENSE_REGEX.test(code)) {
      setStatus('license-activate-status', MSG.LICENSE_INVALID, 'error');
      return;
    }
    var result = await activateLicenseCode(code);
    if (result.ok) {
      setStatus('license-activate-status', MSG.LICENSE_OK, 'ok');
    } else {
      setStatus('license-activate-status', result.error || MSG.LICENSE_NOT_FOUND, 'error');
    }
  }

  function onBuyPro() {
    startMidtransCheckout();
  }

  function onMaskClick() {
    var ta = byId('textarea-letter-text');
    if (!ta) return;
    ta.value = maskBasicPII(String(ta.value || ''));
    setStatus('analyzer-status', MSG.MASK_DONE, 'ok');
    updateRunButtons();
  }

  async function onFileSelected(file) {
    var statusId = 'pdf-status';
    var ta = byId('textarea-letter-text');
    if (!file) return;
    setStatus(statusId, MSG.PDF_READING, null);
    try {
      var text = await extractPdfTextClientSide(file);
      if (ta) ta.value = text;
      setStatus(statusId, 'PDF berhasil dibaca: ' + text.length + ' karakter (diproses 100% di browser, tidak diunggah). Periksa teksnya, lalu gunakan tombol Samarkan Data Pribadi.', 'ok');
    } catch (err) {
      setStatus(statusId, err && err.message ? err.message : MSG.FILE_INVALID, 'error');
    }
    updateRunButtons();
  }

  /* ---------- Inisialisasi UI ---------- */
  function initAnalyzer() {
    var ta = byId('textarea-letter-text');
    var consent = byId('checkbox-pdp-consent');
    var fileInput = byId('input-pdf-file');
    var dropzone = byId('pdf-dropzone');

    if (ta) ta.addEventListener('input', updateRunButtons);
    if (consent) consent.addEventListener('change', updateRunButtons);

    var maskBtn = byId('btn-mask-pii');
    if (maskBtn) maskBtn.addEventListener('click', onMaskClick);
    var teaserBtn = byId('btn-run-teaser');
    if (teaserBtn) teaserBtn.addEventListener('click', runFreeTeaser);
    var proBtn = byId('btn-run-pro');
    if (proBtn) proBtn.addEventListener('click', runProAnalysis);
    var activateBtn = byId('btn-activate-license');
    if (activateBtn) activateBtn.addEventListener('click', onActivateLicense);
    var buyBtn = byId('btn-buy-pro');
    if (buyBtn) buyBtn.addEventListener('click', onBuyPro);

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        onFileSelected(fileInput.files && fileInput.files[0]);
      });
    }
    if (dropzone && fileInput) {
      ['dragenter', 'dragover'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });
      dropzone.addEventListener('drop', function (e) {
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) onFileSelected(file);
      });
    }

    // PS-007: migrasi key lisensi lama, lalu auto-sync kuota jika lisensi tersimpan.
    migrateLicenseKey();
    if (getStoredLicense()) {
      syncLicenseQuota();
    }

    updateRunButtons();
  }

  var api = {
    API_BASE: API_BASE,
    LICENSE_REGEX: LICENSE_REGEX,
    EMAIL_REGEX: EMAIL_REGEX,
    MSG: MSG,
    maskBasicPII: maskBasicPII,
    validatePdfFile: validatePdfFile,
    extractPdfTextClientSide: extractPdfTextClientSide,
    trackEvent: trackEvent,
    sanitizeEventProps: sanitizeEventProps,
    activateLicenseCode: activateLicenseCode,
    syncLicenseQuota: syncLicenseQuota,
    migrateLicenseKey: migrateLicenseKey,
    startMidtransCheckout: startMidtransCheckout,
    renderProReport: renderProReport,
    printProReport: printProReport,
    runFreeTeaser: runFreeTeaser,
    runProAnalysis: runProAnalysis,
    initAnalyzer: initAnalyzer
  };
  if (typeof module === 'object' && module.exports) {
    return api;
  }

  // Browser: auto-init setelah DOM siap (script dimuat di akhir body).
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAnalyzer);
    } else {
      initAnalyzer();
    }
  }
  return api;
});
