# PesangonCVKita (pesangon.cvkita.id)

Kalkulator hak ketenagakerjaan saat PHK/resign: Uang Pesangon (UP), UPMK, UPH, kompensasi PKWT, dan PPh 21 Final — sesuai **PP 35/2021** & **PP 68/2009**. Plus **AI Bedah Surat PHK/Resign** (Pro, Rp 29.000 sekali bayar / 5 kuota).

Bagian ekosistem CVKita: [CVKita.id](https://cvkita.id) · [GajiCVKita](https://gaji.cvkita.id)

## Stack
- Frontend: vanilla HTML/CSS/JS (mobile-first 375px), GitHub Pages + Cloudflare proxy
- Kalkulator: 100% client-side, tanpa request jaringan
- Backend (task berikutnya): Cloudflare Worker (`ps:` KV prefix) + Midtrans Snap + OpenRouter

## Development
```bash
npm install --registry=https://registry.npmjs.org/ --legacy-peer-deps
npx playwright test      # E2E smoke (375x812 + 1280x800)
npm run test:unit        # vitest (engine, task PS-002+)
```

## Konvensi
- Cache-bust: naikkan `?v=N` di semua HTML saat CSS/JS berubah
- Tap target min 44px, nominal uang `.money-value` anti-wrap
- Notice privasi UU PDP terpisah: kalkulator (lokal, hijau) vs AI (terenkripsi, amber)
