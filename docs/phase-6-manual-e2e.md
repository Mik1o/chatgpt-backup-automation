# Phase 6 Manual End-to-End Command

## A. Goal

Phase 6 adds:

- `.local/bin/npm run doctor` for environment and runtime preflight checks.
- `.local/bin/npm run run:once` for one manually confirmed export-and-organize workflow.

It does not add scheduling or unattended operation.

## B. Current Architecture

The workflow still uses a manually started automation-only Google Chrome profile, a manually loaded unpacked ChatGPT-Backup extension, and Playwright connecting through CDP at `127.0.0.1:9222`.

`run:once` performs fatal preflight, requests one explicit account/runtime confirmation, calls the existing Phase 4 export workflow, then passes that Phase 4 summary directly to the existing Phase 5 organizer.

## C. Why This Is Not Unattended

The user must still:

- Start automation Chrome with `scripts/start-cdp-chrome.sh`.
- Confirm the unpacked extension is loaded and refresh the ChatGPT page after extension changes.
- Complete login, Cloudflare, 2FA, or other interactive checks.
- Confirm the configured account, Personal space, English UI, and a recent non-project chat.

Phase 7 is responsible for scheduling, missed-run behavior, and notifications.

## D. Configuration

Runtime config remains ignored at:

```text
/Users/one/chatgpt-backup-automation/.local/config.json
```

Required fields:

```json
{
  "target_email": "person@example.com",
  "archive_root": "/Users/one/Documents/ChatGPT_Backups",
  "recent_bucket_name": "最近对话"
}
```

Optional compatible overrides:

```json
{
  "cdp_url": "http://127.0.0.1:9222",
  "staging_dir": "/Users/one/Downloads/ChatGPT_Backup_Staging",
  "chrome_user_data_dir": "/Users/one/chatgpt-backup-automation/.local/chrome-user-data-cdp"
}
```

## E. Doctor

Run:

```sh
cd /Users/one/chatgpt-backup-automation
.local/bin/npm run doctor
```

Doctor checks Node, dependencies, Playwright, config, writable runtime/archive/staging directories, launcher availability, optional CDP/ChatGPT page/extension ping, staging ZIP count, archive index readability, and the latest Phase 5 summary.

Doctor writes:

```text
.local/state/doctor-summary-<timestamp>.json
```

CDP, ChatGPT page, and extension availability are warnings for doctor when unavailable. A successful bridge ping confirms the extension content script and allows doctor to report success. Invalid config or unwritable required directories are fatal.

## F. Run Once

Before running:

```sh
cd /Users/one/chatgpt-backup-automation
./scripts/start-cdp-chrome.sh
```

In automation Chrome:

1. Confirm ChatGPT-Backup is visible in `chrome://extensions`.
2. Reload the unpacked extension after source changes.
3. Refresh the ChatGPT page so the latest content script is injected.
4. Complete login or interactive verification.
5. Confirm Personal space and English UI.
6. Open a recent normal chat, not a project chat.

Then run:

```sh
.local/bin/npm run run:once
```

The command requires one explicit terminal confirmation before export.

## G. Chained Workflow

1. Fatal preflight validates config, writable paths, CDP, ChatGPT page, and extension bridge ping.
2. User confirms the configured account and browser state.
3. Phase 4 exports and validates recent and visible-project ZIPs.
4. If recent export succeeds, Phase 5 organizes successful ZIPs.
5. A unified summary and log are written.
6. Chrome remains open, and staging ZIPs remain untouched.

The ping is handled locally by the extension content script. It does not trigger export, call the service worker, or read chat content.

## H. Status Rules

- `success`: preflight passes, recent and all non-empty projects export, and organizer succeeds.
- `partial`: recent succeeds, but a project export or organizer warning is present.
- `failed`: fatal preflight, missing bridge/page/CDP, recent export failure, organizer failure, or index write failure.

## I. Runtime Artifacts

```text
.local/logs/run-once-<runId>.log
.local/state/run-once-summary-<runId>.json
.local/state/doctor-summary-<timestamp>.json
.local/logs/phase4-run-once-backup-<runId>.log
.local/state/phase4-run-summary-<runId>.json
.local/logs/phase5-organize-<runId>.log
.local/state/phase5-organize-summary-<runId>.json
```

Failures may also produce screenshots under `.local/screenshots/`.

## J. Safety

- No staging ZIP deletion.
- No old archive Markdown deletion.
- No deletion of local records missing from the current remote view.
- No automatic project-rename merging.
- No Chrome shutdown.
- No real config, logs, summaries, ZIPs, Markdown, or `_index.json` committed to Git.

## K. Known Limitations

- The extension must be manually loaded and the ChatGPT page refreshed after content-script changes.
- Account identity uses explicit user confirmation rather than automatic email extraction.
- ChatGPT DOM changes can still affect project discovery/navigation.
- A full Phase 6 E2E run requires automation Chrome and CDP to be active.

## L. Current Verification And Phase 7

Verified on June 6, 2026:

- Doctor completed with `success`, exit code 0, and returned to the shell without closing automation Chrome.
- Config, dependencies, writable paths, CDP, ChatGPT page, extension bridge ping, staging inventory, archive root, `_index.json`, and latest Phase 5 summary passed.
- An earlier `run:once` correctly stopped at fatal preflight before export or organizer when CDP was unavailable.
- Full `run:once` E2E completed successfully with run ID `phase6-run-2026-06-06_221938`.
- Phase 4 exported recent conversations and four projects into five verified ZIPs containing 29 Markdown entries.
- Phase 5 processed all five ZIPs, wrote 29 entries with zero warnings or failed ZIPs, and updated `_index.json`.
- The archive contains 27 unique conversation files because three project entries share one `conversation_id` and correctly update one archive file.
- All archived Markdown files passed frontmatter validation, staging ZIPs remained present, and automation Chrome remained open.

Phase 7 may add LaunchAgent scheduling, missed-run policy, and notifications.
