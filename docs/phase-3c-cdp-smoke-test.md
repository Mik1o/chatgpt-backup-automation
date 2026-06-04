# Phase 3C CDP Smoke Test

## A. 为什么从 Playwright launch 改为 connectOverCDP

Phase 3 用 Playwright 启动 Google Chrome Stable 时，Chrome 在启动阶段访问日常 Chrome Crashpad 路径，违反隔离边界并失败。

Phase 3B 用 Playwright bundled Chromium 时，浏览器启动仍受 Crashpad 问题阻塞，且用户反馈手动浏览器环境更适合完成 Cloudflare / 登录确认。

Phase 3C 因此不再由 Playwright launch 浏览器，而是连接用户在 Terminal.app 中手动启动的 automation-only Chrome：

```text
Playwright -> chromium.connectOverCDP("http://127.0.0.1:9222")
```

## B. 手动启动 Chrome 命令

Use:

```sh
/Users/one/chatgpt-backup-automation/scripts/start-cdp-chrome.sh
```

The script directly invokes:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

with these important arguments:

- `--remote-debugging-address=127.0.0.1`
- `--remote-debugging-port=9222`
- `--user-data-dir=/Users/one/chatgpt-backup-automation/.local/chrome-user-data-cdp`
- `--disable-extensions-except=/Users/one/chatgpt-backup-automation/extension/chatgpt-backup`
- `--load-extension=/Users/one/chatgpt-backup-automation/extension/chatgpt-backup`
- `https://chatgpt.com/`

The script checks whether port `9222` is already in use and refuses to kill existing processes.

## C. 使用的独立 user-data-dir

```text
/Users/one/chatgpt-backup-automation/.local/chrome-user-data-cdp
```

## D. 如何确认没有使用日常 Chrome profile

The manual launch script uses `--user-data-dir` pointing inside this project’s ignored `.local/` directory.

It does not use:

```text
/Users/one/Library/Application Support/Google/Chrome
```

It also does not use `open -a`, so it should not intentionally reuse a normal daily Chrome instance.

## E. 用户手动确认步骤

In the automation Chrome started by `scripts/start-cdp-chrome.sh`, the user must manually:

1. Complete Cloudflare / human verification if shown.
2. Log in to the target ChatGPT account.
3. Confirm the current space is Personal.
4. Confirm the UI is English.
5. Open a recent chat, not a project chat.

Then run:

```sh
cd /Users/one/chatgpt-backup-automation
.local/bin/npm run phase3c:smoke
```

The npm script explicitly uses Codex’s bundled Node binary so it works even when Terminal.app has no global `node`.

## F. CDP 连接结果

Current managed-environment run:

- CDP URL: `http://127.0.0.1:9222`
- Result: failed with `ECONNREFUSED 127.0.0.1:9222`
- Cause: automation Chrome was not running on port `9222` in this environment.

This is an expected clear failure mode when the user has not yet run the manual Chrome startup script.

## G. extension / content-script bridge 测试结果

Not reached.

The script could not connect to CDP, so it did not inspect pages, select a ChatGPT tab, or trigger the bridge.

## H. silent download 测试结果

Not reached.

No runtime message was sent and no ZIP download was attempted.

## I. staging ZIP 检查结果

Not reached.

No ZIP was created by this run.

## J. 是否保留 ZIP

No ZIP was created.

## K. 失败截图/日志位置

- Latest log: `.local/logs/phase3c-cdp-smoke-test-2026-06-04_110438.log`
- Result JSON: `.local/state/phase3c-cdp-smoke-result.json`
- Screenshot: none. No browser page was connected.

## L. Go / No-Go 结论

Partial.

The Phase 3C harness and manual Chrome launcher are in place, but runtime bridge/download validation has not yet happened because no Chrome instance was listening on `127.0.0.1:9222` during the managed-environment run.

This is not a successful smoke test yet.

## M. Phase 4 建议

Do not start Phase 4 until Phase 3C succeeds.

Recommended next steps:

1. In Terminal.app, run `scripts/start-cdp-chrome.sh`.
2. Complete Cloudflare/login/Personal/English/recent-chat confirmation manually.
3. In a second Terminal.app tab, run `.local/bin/npm run phase3c:smoke`.
4. Only after bridge response and ZIP validation succeed, design Phase 4.

## Validation Commands

- `git status before`: clean; branch was ahead by previous phase commits.
- `node -v`: `v24.14.0`
- `.local/bin/npm -v`: `11.6.4`
- `.local/bin/npm ls --depth=0`: `playwright@1.60.0`
- `node --check app/phase3c-cdp-smoke-test.js`: passed.
- `bash -n scripts/start-cdp-chrome.sh`: passed.
- `.local/bin/npm run phase3c:smoke`: failed clearly with `ECONNREFUSED 127.0.0.1:9222` and printed the startup script path. The script did not close any browser.
- `git status after`: recorded before commit.
