# Data pasar — proyek v3 (diperbarui 2026-10-09)

Semua CSV berkolom `t,o,h,l,c,v`. `JKSE.csv` di tiap folder = benchmark pasar itu.

| Folder | Isi | Periode | Catatan |
|---|---|---|---|
| `cache_ods/` | 100 saham Kompas100 harian (dari `kompas 100 update.ods`) | 1996 – 2026-07-27 | Harga & volume disesuaikan split. **KLBF.csv ditambal** 87 hari (2024-09-04..2025-01-10) dari Yahoo (celah di ODS). Hari 2026-07-27 di ODS = data setengah hari. |
| `cache_kompas100/JKSE.csv` | IHSG harian | 1990+ | Untuk mesin harian: gabungkan `cache_ods/*.csv` + `JKSE.csv` dalam satu folder (run_resmi.py melakukannya otomatis ke `v3/data_idx_daily`). |
| `idx_2sesi/` | IDX 2 sesi: bar `YYYY-MM-DD 09` (sesi 1) dan `13` (sesi 2, termasuk lelang penutupan 16:00) | 2023-09-07 – 2026-10-08 | Dari arsip per jam ortonlead; **tanpa volume** (v=0). `JKSE.csv` harian bertanda ` 99`. |
| `idx_2sesi_vol/` | Sama dgn `idx_2sesi` + **volume harian tanpa intip** | sama | Bar 09 membawa volume HARI SEBELUMNYA, bar 13 volume hari itu; hari basi (harian h=l atau v=0) → v=0. Volume: ODS s/d 2026-07-24, Yahoo sesudahnya (dan celah KLBF). Dipakai config resmi 2 sesi (filter basi + cap). |
| `idx_1jam/` | IDX per jam (09,10,11,13,14,15,16 = lelang penutupan) | 2023-09 – 2026-10 | Tanpa volume. |
| `indodax_harian/` | Indodax harian, 457 pair IDR | 2015+ | Volume dalam satuan KOIN (nilai Rp = c × v). `JKSE.csv` = BTC/IDR. |
| `indodax_d1h/` | Indodax harian disusun dari bar per jam (UTC) | per pair | 209 pair. |
| `indodax_12h/` | Indodax 12 jam (bar 00 / 12 UTC) dari bar per jam | per pair | 209 pair. |
| `indodax_1jam/` *(zip terpisah)* | Indodax per jam, 209 pair (~5,7 juta bar), waktu `YYYY-MM-DD HH:MM` UTC | sejak ~196 hari sesudah listing (BTC penuh) | API Indodax `tradingview/history_v2`. 6 pair < 500 bar dibuang. |
| `saham_as/` | 100 saham AS besar (Yahoo) | 2000+ | Disesuaikan split & dividen (harga & volume). `JKSE.csv` = S&P 500. |

Keterbatasan: universe = anggota SEKARANG (Kompas100, 100 saham AS terbesar, pair Indodax yang ada) → bias survivorship.
