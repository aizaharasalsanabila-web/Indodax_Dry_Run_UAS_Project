# Status data forward test

- Tidak ada log forward test historis dari 4 November yang disertakan karena bot belum dijalankan pada tanggal tersebut.
- `data/forward_logs.json` baru dibuat oleh `npm run logs:export` setelah deployment dan tick pertama.
- `data/snapshots.jsonl` harus berisi order-book snapshots mentah yang benar-benar diambil dari API Indodax.
- `data/history_4h/` dibuat oleh `npm run data:download` dari API publik Indodax.
- Jangan mengisi file ini dengan data contoh seolah-olah data aktual.
