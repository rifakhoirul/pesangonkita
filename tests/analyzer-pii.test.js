/**
 * PS-004 — Unit test maskBasicPII (Vitest).
 * Kontrak Spec_Summary PS-004 poin 2: NIK 16 digit, email, no HP Indonesia
 * (08... / +628... / 628...), NPWP berformat -> token [*_DISAMARKAN].
 * Pure function deterministik: input sama -> output sama.
 */
import { describe, it, expect } from 'vitest';
import analyzer from '../js/analyzer.js';

const { maskBasicPII } = analyzer;

describe('PS-004 maskBasicPII', () => {
  it('menyamarkan NIK 16 digit', () => {
    expect(maskBasicPII('NIK saya 3204012503980001 sesuai KTP.')).toBe(
      'NIK saya [NIK_DISAMARKAN] sesuai KTP.'
    );
  });

  it('menyamarkan email', () => {
    expect(maskBasicPII('Kirim ke budi.santoso@gmail.com ya.')).toBe(
      'Kirim ke [EMAIL_DISAMARKAN] ya.'
    );
  });

  it('menyamarkan no HP format 08', () => {
    expect(maskBasicPII('Hubungi saya di 081234567890 segera.')).toBe(
      'Hubungi saya di [NO_HP_DISAMARKAN] segera.'
    );
  });

  it('menyamarkan no HP format +62 dan 62 sekaligus', () => {
    expect(maskBasicPII('WA: +6281234567890 atau 6281234567891.')).toBe(
      'WA: [NO_HP_DISAMARKAN] atau [NO_HP_DISAMARKAN].'
    );
  });

  it('menyamarkan NPWP berformat', () => {
    expect(maskBasicPII('NPWP perusahaan: 01.234.567.8-901.345')).toBe(
      'NPWP perusahaan: [NPWP_DISAMARKAN]'
    );
  });

  it('menyamarkan semua PII dalam satu teks campuran', () => {
    const input =
      'Surat PHK untuk Andi, NIK 3204012503980002, email andi@corp.co.id, telp 081298765432, NPWP 02.345.678.9-012.345.';
    const out = maskBasicPII(input);
    expect(out).toContain('[NIK_DISAMARKAN]');
    expect(out).toContain('[EMAIL_DISAMARKAN]');
    expect(out).toContain('[NO_HP_DISAMARKAN]');
    expect(out).toContain('[NPWP_DISAMARKAN]');
    expect(out).not.toContain('3204012503980002');
    expect(out).not.toContain('andi@corp.co.id');
    expect(out).not.toContain('081298765432');
    expect(out).not.toContain('02.345.678.9-012.345');
  });

  it('teks tanpa PII tidak berubah dan deterministik', () => {
    const text = 'Dengan ini diberitahukan bahwa terjadi efisiensi sesuai Pasal 40 PP 35/2021.';
    expect(maskBasicPII(text)).toBe(text);
    expect(maskBasicPII(text)).toBe(maskBasicPII(text));
  });

  it('beberapa NIK sekaligus tersamarkan semua', () => {
    const out = maskBasicPII('NIK A 3204012503980003, NIK B 3304010101990004.');
    expect(out).toBe('NIK A [NIK_DISAMARKAN], NIK B [NIK_DISAMARKAN].');
  });

  it('input bukan string dikembalikan sebagai string kosong', () => {
    expect(maskBasicPII(undefined)).toBe('');
    expect(maskBasicPII(null)).toBe('');
    expect(maskBasicPII(12345)).toBe('');
  });
});
