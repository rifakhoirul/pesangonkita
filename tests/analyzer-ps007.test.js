/**
 * PS-007 — Unit test fitur paywall/analytics (Vitest, environment node).
 * Kontrak Spec_Summary PS-007:
 *  - trackEvent(name, props) ringan: catat ke window.__psEvents (in-memory),
 *    forward ke window.gtag/window.plausible jika ada, TANPA PII
 *    (gaji, teks surat, NIK, email, kode lisensi DILARANG masuk payload).
 *  - activateLicenseCode(code): validasi regex PS-XXXX-XXXX, GET
 *    /api/ps/license-status, simpan ke localStorage ps_license_code_v1.
 *  - Migrasi 1x dari key lama ps_license_v1 -> ps_license_code_v1.
 *  - printProReport(): memanggil window.print().
 * Catatan: environment node — DOM absen, fetch/localStorage di-stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import analyzer from '../js/analyzer.js';

const { trackEvent, activateLicenseCode, printProReport, migrateLicenseKey } = analyzer;

describe('PS-007 trackEvent (tanpa PII, 0 KV write, 0 network)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__psEvents;
    delete globalThis.gtag;
    delete globalThis.plausible;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__psEvents;
    delete globalThis.gtag;
    delete globalThis.plausible;
  });

  it('mencatat event ke __psEvents (in-memory)', () => {
    trackEvent('calc_completed', { mode: 'PKWT' });
    expect(globalThis.__psEvents).toHaveLength(1);
    expect(globalThis.__psEvents[0].name).toBe('calc_completed');
    expect(globalThis.__psEvents[0].props).toEqual({ mode: 'PKWT' });
  });

  it('meneruskan ke gtag & plausible jika tersedia', () => {
    globalThis.gtag = vi.fn();
    globalThis.plausible = vi.fn();
    trackEvent('teaser_started', { source: 'page' });
    expect(globalThis.gtag).toHaveBeenCalledWith('event', 'teaser_started', { source: 'page' });
    expect(globalThis.plausible).toHaveBeenCalledWith('teaser_started', { props: { source: 'page' } });
  });

  it('tidak crash walau gtag/plausible lempar error', () => {
    globalThis.gtag = () => { throw new Error('boom'); };
    expect(() => trackEvent('license_activated', { valid: true })).not.toThrow();
    expect(globalThis.__psEvents).toHaveLength(1);
  });

  it('TIDAK menyimpan PII: email, kode lisensi, gaji, NIK dibuang dari props', () => {
    trackEvent('checkout_clicked', { email: 'budi.santoso@gmail.com' });
    trackEvent('license_activated', { code: 'PS-AB12-CD34' });
    trackEvent('calc_completed', { salary: 12345678 });
    trackEvent('offer_gap_checked', { nik: '3204012503980001' });
    trackEvent('mode_switched_pkwt', { note: 'x'.repeat(200) });
    const serialized = JSON.stringify(globalThis.__psEvents);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('PS-');
    expect(serialized).not.toMatch(/\d{7,}/);
  });

  it('membolehkan props aman: boolean, angka kecil, string pendek tanpa PII', () => {
    trackEvent('license_activated', { valid: true, quota: 5, mode: 'PKWT', status: 'KURANG_BAYAR' });
    expect(globalThis.__psEvents[0].props).toEqual({
      valid: true,
      quota: 5,
      mode: 'PKWT',
      status: 'KURANG_BAYAR',
    });
  });

  it('tepat 6 nama event wajib lolos tanpa modifikasi', () => {
    const names = [
      'calc_completed', 'mode_switched_pkwt', 'offer_gap_checked',
      'teaser_started', 'checkout_clicked', 'license_activated',
    ];
    names.forEach((n) => trackEvent(n));
    expect(globalThis.__psEvents.map((e) => e.name)).toEqual(names);
  });
});

describe('PS-007 activateLicenseCode (unit, fetch di-stub)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    globalThis.__psEvents = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__psEvents;
  });

  function stubStorage() {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      _map: store,
    });
    return store;
  }

  it('format salah: ditolak lokal tanpa memanggil fetch', async () => {
    const store = stubStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await activateLicenseCode('SALAH123');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.get('ps_license_code_v1')).toBeUndefined();
  });

  it('server valid: simpan ps_license_code_v1 + emit license_activated {valid:true}', async () => {
    const store = stubStorage();
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valid: true, code: 'PS-AB12-CD34', quota: 5, status: 'active' }),
    })));

    const result = await activateLicenseCode('ps-ab12-cd34'); // lowercase -> dinormalisasi
    expect(result.ok).toBe(true);
    expect(result.quota).toBe(5);
    expect(store.get('ps_license_code_v1')).toBe('PS-AB12-CD34');
    expect(globalThis.__psEvents.some(
      (e) => e.name === 'license_activated' && e.props && e.props.valid === true
    )).toBe(true);
  });

  it('server 404 (kode tak dikenal): tidak tersimpan, tidak emit event sukses', async () => {
    const store = stubStorage();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, valid: false, quota: 0 }),
    })));

    const result = await activateLicenseCode('PS-ZZ99-YY00');
    expect(result.ok).toBe(false);
    expect(store.get('ps_license_code_v1')).toBeUndefined();
    expect(globalThis.__psEvents.some((e) => e.name === 'license_activated')).toBe(false);
  });

  it('network error: gagal ramah, tidak tersimpan', async () => {
    const store = stubStorage();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    const result = await activateLicenseCode('PS-AB12-CD34');
    expect(result.ok).toBe(false);
    expect(store.get('ps_license_code_v1')).toBeUndefined();
  });
});

describe('PS-007 migrasi key lisensi lama', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ps_license_v1 -> ps_license_code_v1 (1x), key lama dihapus', () => {
    const store = new Map([['ps_license_v1', 'PS-AB12-CD34']]);
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });

    migrateLicenseKey();
    expect(store.get('ps_license_code_v1')).toBe('PS-AB12-CD34');
    expect(store.has('ps_license_v1')).toBe(false);
  });

  it('tanpa key lama: tidak ada apa-apa yang ditulis', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });

    migrateLicenseKey();
    expect(store.size).toBe(0);
  });
});

describe('PS-007 printProReport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('memanggil window.print()', () => {
    const printMock = vi.fn();
    vi.stubGlobal('print', printMock);
    printProReport();
    expect(printMock).toHaveBeenCalledTimes(1);
  });
});
