# ChatGPT Backup Automation

This project is for a local macOS automation workflow around a modified copy of the open-source `ChatGPT-Backup` Chrome extension.

Current status: Phase 1 only. The repository has been initialized structurally, the candidate extension source has been copied into `extension/chatgpt-backup/`, and a source feasibility audit has been written.

Do not commit real configuration, logs, screenshots, Chrome user data, login state, downloaded backups, ZIP files, or local runtime state. Runtime artifacts belong under ignored paths such as `.local/`, `chrome-user-data/`, `downloads/`, `staging/`, or `tmp/`.

The first implementation target is macOS + Google Chrome Stable + Node.js + Playwright + a local modified version of `ChatGPT-Backup`.
