# Upload guide — Indodax Dry Run UAS Project

This archive contains the project source files at the repository root. It intentionally excludes `.git/`, `.env` secrets, downloaded market datasets, raw order-book snapshots, forward-test logs, and the assignment PDF.

## Upload using GitHub on a computer

1. Extract this ZIP.
2. Open https://github.com/aizaharasalsanabila-web/Indodax_Dry_Run_UAS_Project.
3. Choose **Add file → Upload files**.
4. Upload the extracted project contents, including the hidden `.github/` folder and `.env.example`.
5. Commit to branch `main`.

Or use Git locally from the extracted folder:

```bash
git init
git branch -M main
git remote add origin https://github.com/aizaharasalsanabila-web/Indodax_Dry_Run_UAS_Project.git
git add .
git commit -m "chore: add Indodax dry-run UAS project source"
git push -u origin main
```

## After upload

- Read `README.md` and `FREEZE_PENDING.md` first.
- Configure Vercel environment variables using `.env.example` as a key-name reference only.
- Add GitHub Actions secrets `BOT_URL` and `CRON_SECRET`.
- Run the historical download, universe check, preflight snapshots, and backtest before recording a truthful late-freeze commit.
- Do not fabricate the missed 4 November freeze or historical forward-test logs.
