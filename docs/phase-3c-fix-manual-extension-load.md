# Phase 3C-Fix Manual Extension Load

## A. Why Not Rely On `--load-extension`

Phase 3C confirmed that Chrome was started with:

```text
--load-extension=/Users/one/chatgpt-backup-automation/extension/chatgpt-backup
--disable-extensions-except=/Users/one/chatgpt-backup-automation/extension/chatgpt-backup
```

However, `chrome://extensions/` did not show `ChatGPT-Backup`, and the automation profile's extension registry did not contain the extension. The command-line flags reached Chrome, but Chrome did not register the unpacked extension in this profile.

Phase 3C-fix therefore uses the automation-only profile and asks the user to manually load the unpacked extension once.

## B. Manual Load Unpacked Steps

1. Start automation Chrome:

```sh
cd /Users/one/chatgpt-backup-automation
./scripts/start-cdp-chrome.sh
```

2. In that Chrome window, open:

```text
chrome://extensions/
```

3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select:

```text
/Users/one/chatgpt-backup-automation/extension/chatgpt-backup
```

6. If Chrome shows an error, copy the full error text and stop.
7. If loading succeeds, confirm `ChatGPT-Backup` is visible and enabled.
8. Open or refresh `https://chatgpt.com/`.
9. Complete Cloudflare/login if shown.
10. Confirm Personal space, English UI, and a recent normal chat.

## C. Automation-Only Profile

```text
/Users/one/chatgpt-backup-automation/.local/chrome-user-data-cdp
```

This directory is ignored by Git through `.gitignore`.

## D. Daily Chrome Profile Isolation

The launcher uses:

```text
--user-data-dir=/Users/one/chatgpt-backup-automation/.local/chrome-user-data-cdp
```

It does not use:

```text
/Users/one/Library/Application Support/Google/Chrome
```

It also invokes the Chrome binary directly rather than using `open -a`.

## E. Load Error Evidence To Capture

If `Load unpacked` fails, capture:

- The exact Chrome error text.
- Whether the `ChatGPT-Backup` card appears.
- Whether the card shows an `Errors` button.
- Any manifest line/file mentioned by Chrome.

Do not proceed to Phase 4 if the extension cannot be manually loaded.

## F. Smoke Test After Manual Load

After `ChatGPT-Backup` is visible in `chrome://extensions/`, run:

```sh
cd /Users/one/chatgpt-backup-automation
.local/bin/npm run phase3c:smoke
```

After pressing Enter in the smoke test, do not refresh, navigate, or switch conversations until the test returns.

## G. Go / No-Go Criteria

Go:

- `chrome://extensions/` shows `ChatGPT-Backup`.
- The ChatGPT recent chat page returns a content-script bridge response.
- `/Users/one/Downloads/ChatGPT_Backup_Staging` receives `chatgpt-backup__recent__*.zip`.
- The ZIP is readable.
- The ZIP contains at least one `.md` file.

No-Go:

- Manual `Load unpacked` reports a manifest/load error.
- `chrome://extensions/` still does not show `ChatGPT-Backup`.
- The bridge times out.
- Silent ZIP download does not occur.
- The ZIP cannot be read or contains no `.md` files.

## H. Phase 4 Preconditions

Do not start Phase 4 until Phase 3C or Phase 3C-fix succeeds end to end:

- Manual extension loading is confirmed.
- CDP smoke connects to the correct Chrome profile.
- The bridge responds on a recent ChatGPT conversation.
- A silent Markdown ZIP download is validated.
