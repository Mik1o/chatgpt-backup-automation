# Phase 5 Staging ZIP Organizer

## A. Stage Goal

Phase 5 adds a safe organizer that reads a successful Phase 4 summary and its staging ZIPs, then writes a long-term Markdown archive with organizer-managed frontmatter and an account-level `_index.json`.

This stage does not export from ChatGPT, schedule jobs, delete staging ZIPs, or start Phase 6.

## B. Inputs

The organizer reads:

- A Phase 4 summary JSON from `.local/state/phase4-run-summary-*.json`.
- Only successful recent/project ZIPs referenced by that summary.
- Only ZIPs inside `/Users/one/Downloads/ChatGPT_Backup_Staging/`.

An explicit summary may be supplied:

```sh
.local/bin/npm run phase5:organize -- --summary .local/state/phase4-run-summary-<runId>.json
```

Without `--summary`, the latest Phase 4 summary is selected.

## C. Runtime Config

Config location:

```text
/Users/one/chatgpt-backup-automation/.local/config.json
```

Template:

```json
{
  "target_email": "REPLACE_WITH_TARGET_CHATGPT_EMAIL",
  "archive_root": "/Users/one/Documents/ChatGPT_Backups",
  "recent_bucket_name": "最近对话"
}
```

If the file is missing, the organizer creates this template and stops. It never guesses the target email.

## D. Archive Layout

```text
<archive_root>/<target_email>/
  最近对话/
    <conversation-title>.md
  <project-name>/
    <conversation-title>.md
  _index.json
```

Chinese and other non-ASCII directory names are preserved. Unsafe path characters are replaced. Sanitized project-name collisions receive a short hash suffix.

## E. ZIP Extraction

- ZIP entries are listed and checked for path traversal before extraction.
- Each ZIP extracts into `.local/tmp/phase5-organize/<organizerRunId>/<zip-basename>/`.
- Only non-hidden `.md` files are processed.
- ZIP-internal directories do not determine the archive bucket or project.
- Staging ZIPs remain untouched.

## F. Markdown Frontmatter

The organizer prepends frontmatter containing:

- `source`
- `account_email`
- `space`
- `bucket`
- `project_name`
- `title`
- `exported_at`
- `backup_run_id`

Extractable optional metadata includes conversation, project, branch, created, and updated IDs/timestamps.

Existing organizer frontmatter with `source: chatgpt-backup` is replaced. Other existing frontmatter is preserved below the new organizer frontmatter and produces a warning.

## G. Conversation Identity

- `conversation_id`, when extractable, is the primary identity.
- Otherwise a weak key uses bucket, project name, and original ZIP entry name.
- Existing index mappings are reused on subsequent runs.
- Filename conflicts append a short conversation ID, source-entry name, or content hash.

## H. `_index.json`

The account-level index records organizer runs and conversations.

- Existing conversations not seen in the current run are preserved.
- Existing conversation IDs or weak keys are updated, not duplicated.
- Existing `_index.json` is backed up before update.
- Writes use a temporary file followed by rename.

## I. Safety Strategy

- All final paths are checked to remain inside the account archive root.
- Markdown and index writes are atomic.
- Existing matching archive files may be overwritten and are recorded as such.
- Old Markdown files, old project directories, staging ZIPs, and unreferenced index entries are never deleted.
- Project renames are not automatically merged.

## J. Artifacts

- Archive: `<archive_root>/<target_email>/`
- Log: `.local/logs/phase5-organize-<organizerRunId>.log`
- Summary: `.local/state/phase5-organize-summary-<organizerRunId>.json`
- Extraction: `.local/tmp/phase5-organize/<organizerRunId>/`

## K. Known Limitations

- Metadata extraction is best effort and depends on exported Markdown content/frontmatter.
- Attachments, images, uploads, and Code Interpreter outputs are not processed.
- Weak-key identity may not detect a conversation renamed inside the same bucket.
- This stage does not verify the configured email against the ChatGPT UI.

## L. Go / No-Go

Current result: Partial until `.local/config.json` contains a valid target email and the organizer is rerun.

No final archive should be written while the config still contains the template target email.

Verified config-gate run:

- Organizer run ID: `phase5-organize-2026-06-06_092059`
- Result: partial
- ZIPs processed: 0
- Markdown written: 0
- Account archive root: not created
- Reason: config template created; target email still requires user input

## M. Phase 6 Recommendation

Do not start Phase 6 until Phase 5 successfully processes all Phase 4 success ZIPs, writes frontmatter Markdown, and creates or updates `_index.json`.
