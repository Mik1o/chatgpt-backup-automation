# Phase 4 Run-Once Backup Prototype

## A. Stage Goal

Phase 4 extends the verified Phase 3C recent-chat smoke test into a one-time backup workflow. It exports recent chats, discovers visible projects, exports each project, validates every ZIP, and writes a structured run summary.

This remains a prototype. It does not organize final archives, write frontmatter, update `_index.json`, install scheduling, or start Phase 5.

## B. Current Architecture

```text
Manual automation-only Chrome
  -> manually loaded unpacked ChatGPT-Backup extension
  -> Playwright connects over CDP at 127.0.0.1:9222
  -> page bridge requests recent/project exports
  -> extension downloads ZIPs into Downloads/ChatGPT_Backup_Staging
```

The workflow never uses the daily Chrome profile and does not close the manually started Chrome.

## C. Manual Steps Before Running

1. Run `scripts/start-cdp-chrome.sh` in Terminal.app.
2. Confirm `ChatGPT-Backup` is loaded in `chrome://extensions/`.
3. Open and log in to `https://chatgpt.com/`.
4. Complete Cloudflare, login, or 2FA manually if shown.
5. Confirm Personal space and English UI.
6. Open a recent normal conversation.
7. Run:

```sh
cd /Users/one/chatgpt-backup-automation
.local/bin/npm run phase4:run-once
```

## D. Recent Export Result

Verified run:

- Run ID: `phase4-run-2026-06-06_085156`
- Status: success
- ZIP: `chatgpt-backup__recent__recent__phase4-run-2026-06-06_085156.zip`
- Markdown files: 17

## E. Project Discovery Method

The workflow discovers visible project names using sidebar buttons whose `aria-label` starts with:

```text
Open project options for
```

For each named project, it expands that exact sidebar row using its `data-sidebar-item` element. It then selects the first visible `/g/.../c/...` conversation link from the same project row only.

This row-scoped selection prevents an old project conversation URL from being reused for another project.

## F. Project Export Result

Verified run discovered and exported four distinct projects:

- `程嘉杭‘s`: success, 3 Markdown files
- `数字枫桥`: success, 5 Markdown files
- `COLING`: success, 3 Markdown files
- `数据标注`: success, 1 Markdown file

Each project resolved to a distinct project URL and succeeded on the first attempt.

## G. ZIP Validation

Each export:

- Requires the exact expected `chatgpt-backup__<bucket>__<name>__<runId>.zip` filename.
- Rejects `download.zip`.
- Rejects an active corresponding `.crdownload`.
- Requires file size stability for at least three seconds.
- Uses `unzip -l` to verify readability.
- Requires at least one `.md` or `.mdx` entry.

ZIPs are retained in staging and are not extracted into the final archive directory.

## H. Failure And Partial-Failure Strategy

- CDP/page/health/recent failures stop the workflow and produce `failed`.
- A project export is retried once.
- A project with no visible conversation is `skipped_empty`.
- A failed project is recorded and later projects continue.
- Recent success plus any failed project produces `partial`.
- Failure screenshots are written to `.local/screenshots/`, with at most 50 retained.

The health check does not scan conversation body text.

## I. Artifact Locations

- Staging ZIPs: `/Users/one/Downloads/ChatGPT_Backup_Staging/`
- Log: `.local/logs/phase4-run-once-backup-phase4-run-2026-06-06_085156.log`
- Summary: `.local/state/phase4-run-summary-phase4-run-2026-06-06_085156.json`
- Failure screenshots: `.local/screenshots/`

## J. Known Limitations

- Project discovery depends on the current ChatGPT sidebar DOM and English accessibility labels.
- Only currently visible projects are discovered.
- The workflow uses the first visible conversation in each project as export context.
- The user must manually maintain the automation-only Chrome profile, login, and unpacked extension.
- No final archive organization or deduplication is performed.

## K. Go / No-Go Conclusion

Go for Phase 4.

The verified run completed recent and all four visible project exports. Five ZIPs were readable and contained 29 Markdown files total.

## L. Phase 5 Recommendation

Phase 5 can be planned next. It should focus on configuration extraction, repeatable preflight/doctor checks, safe staging-to-archive processing, and scheduling design.

Phase 5 was not started here.
