# Phase 3C Filename Fix

## A. Original Problem

Phase 3C-fix proved that the manual extension load path worked:

- CDP connected to the automation-only Chrome profile.
- The content-script bridge returned `ok: true`.
- A ZIP was downloaded silently to staging.
- The ZIP was readable and contained Markdown files.

The remaining failure was filename validation. The bridge response reported:

```text
chatgpt-backup__recent__最近对话__phase3c-smoke-2026-06-05_094001.zip
```

but Chrome wrote:

```text
download.zip
```

## B. Root Cause Analysis

The automation path generated the expected filename and passed it to `chrome.downloads.download`.

The ZIP payload used a `data:application/zip;base64,...` URL. In the observed Chrome run, that URL was downloaded as Chrome's default `download.zip`, even though the extension response carried the desired filename.

Additional probes showed the decisive factor: CDP `Browser.setDownloadBehavior` with a `downloadPath` made Chrome ignore extension-supplied filenames. Resetting CDP download behavior to `default` restored filename handling.

The final fix uses Chrome's default Downloads directory and makes the extension pass a relative Chrome downloads filename:

```text
ChatGPT_Backup_Staging/<expected zip basename>
```

## C. Modified Files

- `extension/chatgpt-backup/service-worker.js`
- `app/phase3c-cdp-smoke-test.js`
- `tests/phase3c-filename-static.test.js`
- `docs/phase-3c-filename-fix.md`

## D. Filename Flow

1. `app/phase3c-cdp-smoke-test.js` sends:

```text
bucket=recent
name=recent
backupRunId=phase3c-smoke-...
```

2. `content-script.js` forwards the payload to the service worker.
3. `service-worker.js` validates the payload.
4. `buildAutomationZipFilename` creates:

```text
chatgpt-backup__recent__recent__<backupRunId>.zip
```

5. The automation download passes:

```text
response filename=<expected basename>
chrome downloads filename=ChatGPT_Backup_Staging/<expected basename>
saveAs=false
```

6. The smoke harness resets CDP download behavior to `default`, with no `downloadPath`, so Chrome honors the extension's relative filename.

## E. `saveAs: false` Behavior

Automation exports still use `saveAs: false` so Chrome downloads silently.

The staging directory is selected by the extension's relative downloads filename, not by CDP download-path override.

## F. Popup UI Compatibility

Manual popup exports do not pass `chromeFilename`.

Manual export behavior remains unchanged and still uses the existing default `saveAs` behavior.

## G. Smoke Payload Name

The Phase 3C smoke test now uses an ASCII name:

```text
recent
```

This avoids mixing filename validation with non-ASCII filename compatibility. The filename sanitizer still permits non-ASCII names for project labels.

## H. Validation Result

Static validation passed:

- `node --check extension/chatgpt-backup/service-worker.js`
- `node --check extension/chatgpt-backup/scripts/content-script.js`
- `node --check app/phase3c-cdp-smoke-test.js`
- `node tests/phase3c-filename-static.test.js`

Runtime smoke still needs the currently loaded unpacked extension to be reloaded in `chrome://extensions` before rerunning.

Runtime smoke passed after reload:

- Log: `.local/logs/phase3c-cdp-smoke-test-2026-06-05_100433.log`
- Bridge response: `ok: true`
- Actual ZIP: `/Users/one/Downloads/ChatGPT_Backup_Staging/chatgpt-backup__recent__recent__phase3c-smoke-2026-06-05_100433.zip`
- ZIP size: `448595`
- Markdown files: `14`

## I. Go / No-Go

Go requires a new runtime smoke result where:

- Bridge response is `ok: true`.
- A new ZIP appears in staging.
- The actual basename starts with `chatgpt-backup__recent__`.
- The actual basename ends with `.zip`.
- The actual basename is not `download.zip`.
- The ZIP is readable and contains at least one `.md` file.

Go for Phase 3C-filename-fix is satisfied by the `2026-06-05_100433` smoke run.

No-Go if a future run writes `download.zip` or the ZIP cannot be validated.

## J. Phase 4

Phase 3C filename validation passed. Phase 4 can be planned next, but was not started in this phase.
