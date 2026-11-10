# Indodax Crypto Dry Run — UAS Algorithmic Trading

**Mode is DRY RUN ONLY.** The program only calls Indodax public market-data endpoints. It does not submit buy/sell orders, does not use an Indodax API key, and does not move real funds.

## 1. Hubungan dengan file UTS

Logika asli UTS tetap dirujuk melalui `reference/README_UTS.md` dan `reference/engine_uts.cjs`. Bundle JS audit 9,5 MB yang dikirim sebelumnya tidak disalin ke paket runtime karena berisi dataset/research bundle saham dan tidak diperlukan untuk menjalankan bot Indodax. Strategi UTS A yang berorientasi saham harian (breakout 100 bar, EMA50/200, slope, ROC, turnover, ATR stop) tidak dapat dipakai mentah-mentah untuk kripto 4 jam. Proyek ini mempertahankan ide **breakout + trend filter + ATR stop**, lalu mengadaptasi panjang indikator dan eksekusi ke 4h Indodax. Detail strategi yang berlaku ada di `config/strategy.json` dan satu fungsi sinyal bersama ada di `lib/strategy.js`.

## 2. Aturan strategi yang dibekukan

- Pasar: BTCIDR, ETHIDR, XRPIDR, LTCIDR (kandidat; universe final hanya sah setelah `npm run universe:check`).
- Timeframe: 4 jam (`tf=240`).
- Modal virtual: Rp100.000.000.
- Entry: close candle tertutup menembus highest high 60 candle sebelumnya +0,25%; EMA20 > EMA60; EMA60 naik dibanding 12 candle sebelumnya; ROC42 positif; median turnover 60 candle minimal Rp50 juta per candle.
- Exit: low candle tertutup menyentuh stop awal 3×ATR14, atau dua close berturut-turut di bawah EMA30. Setelah exit, pair masuk cooldown 6 candle 4h. Eksekusi simulasi dilakukan pada order book saat tick berikutnya.
- Long-only, tanpa short, margin, atau leverage.
- Maksimum 3 posisi; risiko target 1% equity per posisi; maksimum 20% equity per posisi; gross exposure maksimum 60% equity.
- Daily loss limit 3% dari equity awal hari WIB; hanya memblokir entry baru sampai hari WIB berikutnya.
- Candle yang belum tutup dibuang; candle stale, volume/harga nol, jendela indikator berlubang, order book kosong, atau spread >2% tidak boleh membuka posisi.
- Idempotency: key Redis per pair+candle; candle yang sama tidak dapat memicu order kedua.
- Manual kill switch di Redis dapat dinyalakan/dimatikan lewat `/api/control` tanpa redeploy.

## 3. Catatan data dan survivorship bias

`onaldhi_data_pasar.zip` yang diserahkan berisi folder `indodax_d1h` (harian hasil agregasi bar per jam) dan `indodax_12h`. README data menyebut arsip `indodax_1jam` ada di ZIP terpisah, tetapi ZIP tersebut tidak ikut diunggah. Karena UAS mengizinkan 4h, skrip `scripts/download-history.mjs` mengambil data 4h langsung dari API publik Indodax secara mundur dan berurutan, dengan jeda 450 ms per request.

Universe kandidat dibatasi empat pair besar yang sudah tersedia pada awal periode. `npm run universe:check` menghitung median turnover pada 30 hari pertama backtest, bukan memakai volume hari ini. **Namun** arsip yang diberikan hanya mencakup pair yang masih ada pada data saat arsip dibuat; daftar lengkap pair yang sudah delisting tidak tersedia. Karena itu survivorship bias tidak dapat dihilangkan sepenuhnya dan wajib disebutkan dalam refleksi.

## 4. Biaya dan fill

- Bot live membeli dengan menyapu sisi ask (`sell` pada endpoint depth) dan menjual dengan menyapu sisi bid (`buy`), sampai semua kuantitas terisi. Tidak ada fill di mid atau close. Jika depth terlihat tidak cukup, order simulasi ditolak seluruhnya.
- Fee taker memakai angka yang lebih mahal antara `trade_fee_percent_taker` pada `/api/pairs` dan tarif all-in resmi Indodax: buy IDR 0,20555%, sell IDR 0,41555% (tarif efektif 1 Oktober 2026). URL dan tanggal akses dicatat pada konfigurasi/freeze.
- Minimum order = nilai yang lebih ketat antara Rp25.000 dan `trade_min_base_currency` dari `/api/pairs`.
- Tick harga dan quantity increment dibaca dari `/api/price_increments` dan `/api/pairs`.
- Backtest memakai median spread dan slippage sweep dari snapshot order book mentah. Jika snapshot belum ada, backtest berhenti; tidak boleh mengarang biaya historis. Snapshot pertama yang dikumpulkan setelah jadwal freeze 4 November adalah sampel terlambat, bukan bukti biaya pra-freeze.

## 5. Setup lokal

Butuh Node.js 20+ dan Git.

```bash
npm test
npm run data:download
npm run universe:check
npm run preflight
```

Jalankan `npm run preflight` beberapa kali pada waktu berbeda untuk mengumpulkan snapshot mentah. Setelah itu jalankan:

```bash
npm run backtest
```

Backtest default memeriksa sekurang-kurangnya tiga tahun data. Untuk replay periode forward yang sama (setelah data sampai tanggal akhir sudah diunduh):

```bash
node scripts/backtest.mjs --from=2026-11-10T00:00:00Z --to=2026-11-14T00:00:00Z
```

Hasil backtest ditulis ke `results/backtest.json` atau `results/backtest_forward_window.json`.

## 6. Deploy Vercel dan storage

1. Import repository ini ke Vercel (Node.js runtime).
2. Buat database Upstash Redis dan masukkan `UPSTASH_REDIS_REST_URL` serta `UPSTASH_REDIS_REST_TOKEN` ke Environment Variables Vercel.
3. Buat dua secret acak berbeda: `CRON_SECRET` dan `ADMIN_SECRET`. Jangan commit nilainya.
4. Deploy.
5. Uji `GET /api/status`.
6. Tambahkan GitHub repository secret `BOT_URL` (contoh `https://nama-project.vercel.app`) dan `CRON_SECRET`.
7. Aktifkan GitHub Actions. Workflow berjalan pada menit 7 setiap 4 jam UTC: `7 0,4,8,12,16,20 * * *`.

Vercel Hobby Cron tidak dipakai untuk jadwal 4h karena ketentuan tugas menyebut Hobby hanya sekali sehari; GitHub Actions menjadi scheduler luar. Catat keterlambatan aktual dari log.

## 7. Kill switch

Kirim POST ke `https://BOT_URL/api/control` dengan header `x-admin-secret: ADMIN_SECRET` dan body JSON:

```json
{"action":"kill"}
```

Untuk melanjutkan:

```json
{"action":"resume"}
```

Setiap perubahan tercatat di log. Endpoint `/api/tick` hanya menerima `Authorization: Bearer CRON_SECRET`.

## 8. Forward test dan tanggal yang terlewat

Soal UAS menetapkan freeze Rabu 4 November 2026 pukul 12.00 WIB dan forward test 4 November 12.00 sampai 14 November 12.00 WIB (10 hari penuh). Proyek ini dibuat setelah tanggal mulai tersebut. **Jangan membuat log atau commit palsu bertanggal 4 November.** `state.startedAt` hanya diisi oleh panggilan tick pertama yang benar-benar sukses. Laporan harus mencantumkan tanggal mulai aktual, durasi aktual, dan keterbatasan akibat keterlambatan.

Setelah data historis, universe, snapshot preflight, dan backtest awal siap, set identitas Git lokal lalu jalankan `npm run freeze:record` **sebelum deploy**. Skrip akan mencatat hash konfigurasi dan waktu sebenarnya, membuat commit dan tag `freeze-late-YYYY-MM-DD`. Ini adalah bukti late freeze, bukan bukti freeze tepat waktu. Deploy persis commit tersebut, lalu jalankan workflow manual untuk memulai log pada waktu sebenarnya.

```bash
git config user.name "Nama Mahasiswa"
git config user.email "email-kamu"
npm run freeze:record
```

Setelah bot berjalan, ekspor log:

```bash
BOT_URL=https://nama-project.vercel.app ADMIN_SECRET=... npm run logs:export
npm run backtest -- --from=2026-11-10T00:00:00Z --to=2026-11-14T00:00:00Z
npm run forward:compare
npm run dashboard:build
```

Perintah `backtest --from/--to` di atas hanya contoh; untuk replay, gunakan waktu candle UTC paling awal dan paling akhir dari `signalDecisions` pada `data/forward_logs.json` (bukan waktu wall-clock `state.startedAt`). Periksa `replayWindowMatchesForward` di hasil perbandingan; harus `true` sebelum mengklaim perbandingan jendela identik.

## 9. File bukti

- `freeze.json`: timestamp late freeze, hash konfigurasi, dan universe.
- `.git/`: riwayat commit lokal; pertahankan folder ini jika mengumpulkan ZIP.
- `data/forward_logs.json`: log hasil ekspor Redis.
- `data/snapshots.jsonl`: snapshot order book mentah.
- `results/backtest.json`: backtest minimal 3 tahun.
- `results/backtest_forward_window.json`: replay jendela forward yang sama.
- `results/forward_comparison.json`: perbandingan keputusan sinyal, uptime perkiraan, dan return.
- `public/dashboard-offline.html`: dashboard HTML offline.

Belum ada data/log yang diklaim sebagai hasil aktual sampai proses di atas benar-benar dijalankan.
