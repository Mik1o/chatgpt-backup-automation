# Phase 3 Runtime Smoke Test

## A. 本阶段目标

验证本地修改版 ChatGPT-Backup 扩展在真实自动化浏览器环境里的最小闭环：

Playwright -> Chrome Stable persistent context -> unpacked extension -> `chatgpt.com` page bridge -> service worker automation export -> silent ZIP download to staging.

本阶段未进入完整备份系统、未写 Phase 4 自动化、未访问日常 Chrome Profile、未触碰真实归档目录。

## B. 启动方式

- Script: `app/phase3-smoke-test.js`
- npm script: `.local/bin/npm run phase3:smoke`
- Browser API: `chromium.launchPersistentContext(userDataDir, options)`
- Browser executable: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Extension path: `extension/chatgpt-backup`
- User data dir: `.local/chrome-user-data`
- Chrome HOME override: `.local/chrome-home`
- Staging download dir: `/Users/one/Downloads/ChatGPT_Backup_Staging`
- Key extension args:
  - `--disable-extensions-except=<extension path>`
  - `--load-extension=<extension path>`

The harness also sets Chrome download preferences in the isolated profile and writes runtime results to `.local/state/phase3-smoke-result.json`.

## C. Chrome Stable 是否成功加载扩展

No.

Chrome Stable did not reach the extension-loaded check. It aborted during browser startup before a page or extension service worker could be observed.

The first run failed because Chrome attempted to access:

```text
/Users/one/Library/Application Support/Google/Chrome/Crashpad/settings.dat
```

The harness was then updated to set Chrome process `HOME` to `.local/chrome-home`, add `--disable-crash-reporter`, `--disable-crashpad`, and set `--crash-dumps-dir=.local/tmp/chrome-crash-dumps`. The second run still attempted the same daily Chrome Crashpad path and aborted.

## D. 用户是否完成手动登录确认

No.

The browser exited before reaching `https://chatgpt.com/`, so the script never displayed the manual login / Personal space / English UI confirmation prompt.

## E. bridge 测试结果

Not reached.

The content-script bridge was not exercised because Chrome Stable exited during launch.

## F. silent download 测试结果

Not reached.

The automation runtime message was not sent, so no `saveAs: false` download was triggered.

## G. staging ZIP 检查结果

- Staging path: `/Users/one/Downloads/ChatGPT_Backup_Staging`
- ZIP files before run: none observed by the harness.
- ZIP files after failed run: none observed.
- `.crdownload` files: none observed.
- ZIP readability / markdown count: not applicable.

## H. 是否保留 ZIP

No ZIP was created.

## I. 失败截图/日志位置

- Latest log: `.local/logs/phase3-smoke-test-2026-06-04_093247.log`
- Previous log: `.local/logs/phase3-smoke-test-2026-06-04_093149.log`
- Result JSON: `.local/state/phase3-smoke-result.json`
- Screenshot: none. Browser exited before a page object was available.

Logs are runtime artifacts under `.local/` and are intentionally not tracked by Git.

## J. Go / No-Go 结论

No-Go for runtime validation with the current Chrome Stable launch strategy.

The Phase 3 harness is useful and reproducible, but the runtime smoke test did not validate extension side-load, bridge messaging, or silent ZIP download. The blocking issue is Chrome Stable startup in the managed environment: Chrome attempts to access daily Chrome Crashpad data under `/Users/one/Library/Application Support/Google/Chrome/Crashpad/settings.dat`, then exits.

This is not a successful Phase 3 smoke test.

## K. Phase 4 建议

Do not start Phase 4 until a browser launch strategy is chosen and validated.

Recommended options:

1. Use Playwright bundled Chromium in a later phase, explicitly accepting the tradeoff that it differs from Google Chrome Stable.
2. Use a manually prepared, automation-only Chrome profile outside the managed sandbox, with the unpacked extension installed by hand.
3. Run the Phase 3 harness from a terminal context with permissions that allow Chrome Stable to start without touching the daily profile.
4. Investigate Chrome/Crashpad launch flags or environment settings that fully redirect Crashpad state away from `/Users/one/Library/Application Support/Google/Chrome`.

## Validation Commands

- `git status before`: initially only `package.json` and `package-lock.json` were untracked; those were committed as `stage 2.5: add playwright dependency`.
- `node -v`: `v24.14.0`
- `.local/bin/npm -v`: `11.6.4`
- `.local/bin/npm ls --depth=0`: `playwright@1.60.0`
- `node --check app/phase3-smoke-test.js`: passed.
- `.local/bin/npm run phase3:smoke`: failed during Chrome Stable startup.
