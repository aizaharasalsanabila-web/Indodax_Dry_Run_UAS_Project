# Freeze belum dilakukan

Status per 10 November 2026 (WIB): **belum ada freeze commit UAS dan belum ada forward-test log**.

Freeze terjadwal pada 4 November 2026 pukul 12.00 WIB terlewat. Proyek ini tidak memalsukan waktu, hash, snapshot, order, equity, uptime, atau log masa lalu.

Untuk membuat bukti late-freeze yang valid:
1. Jalankan `npm run data:download` untuk menarik candle 4h historis dari API Indodax.
2. Jalankan `npm run universe:check` untuk memverifikasi universe dengan likuiditas pada awal periode backtest.
3. Jalankan `npm run preflight` dan kumpulkan snapshot order book nyata.
4. Jalankan `npm run backtest` dan periksa hasil serta asumsi biaya.
5. Atur `git config user.name` dan `git config user.email` milik mahasiswa.
6. Jalankan `npm run freeze:record`. Skrip membuat commit dan tag pada waktu sebenarnya, dengan status `LATE_FREEZE`.
7. Deploy commit tersebut, aktifkan scheduler, dan mulai forward test pada tick pertama yang berhasil.

Jangan ubah strategi, parameter, atau universe setelah late-freeze commit. Perbaikan bug hanya boleh dilakukan jika tidak mengubah aturan dan harus dicatat.
