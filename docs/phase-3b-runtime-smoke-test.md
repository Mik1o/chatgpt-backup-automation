# Phase 3B Runtime Smoke Test

## A. 为什么从 Chrome Stable 改为 bundled Chromium

Phase 3 使用 Google Chrome Stable 时，Chrome 在启动阶段尝试访问日常 Chrome Crashpad 数据：

```text
/Users/one/Library/Application Support/Google/Chrome/Crashpad/settings.dat
```

这触碰了隔离边界，因此 Phase 3B 改用 Playwright bundled Chromium，并把浏览器文件安装在项目本地 `.local/ms-playwright/` 下。

## B. 本地 Chromium 安装路径

- Browser install root: `.local/ms-playwright`
- Chromium package: `.local/ms-playwright/chromium-1223`
- Browser binary: `.local/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
- Playwright also installed supporting runtime files under the same ignored `.local/ms-playwright` tree, including `ffmpeg-1011` and `chromium_headless_shell-1223`.

`.local/` remains ignored and is not tracked by Git.

## C. 启动方式

- Script: `app/phase3b-smoke-test.js`
- npm script: `.local/bin/npm run phase3b:smoke`
- Browser API: `chromium.launchPersistentContext(userDataDir, options)`
- Browser type: Playwright bundled Chromium
- `PLAYWRIGHT_BROWSERS_PATH`: `.local/ms-playwright`
- `userDataDir`: `.local/chrome-user-data`
- `stagingDir`: `/Users/one/Downloads/ChatGPT_Backup_Staging`
- Extension args:
  - `--disable-extensions-except=<extension path>`
  - `--load-extension=<extension path>`

The harness does not set `channel: "chrome"` and does not use the Google Chrome Stable executable path.

## D. extension 是否加载成功

No.

Bundled Chromium exited during startup before any page or extension service worker could be observed. The harness did not reach the extension side-load check.

## E. 用户是否完成手动登录确认

No.

The browser exited before loading `https://chatgpt.com/`, so the manual confirmation prompt was never reached.

## F. bridge 测试结果

Not reached.

The page bridge was not tested because bundled Chromium failed during startup.

## G. silent download 测试结果

Not reached.

No automation runtime message was sent, so no `saveAs: false` download occurred.

## H. staging ZIP 检查结果

- Staging path: `/Users/one/Downloads/ChatGPT_Backup_Staging`
- ZIP files before latest run: none observed by harness.
- New ZIP: none.
- `.crdownload`: none observed.
- ZIP readability / markdown count: not applicable.

## I. 是否保留 ZIP

No ZIP was created.

## J. 失败截图/日志位置

- Latest log: `.local/logs/phase3b-smoke-test-2026-06-04_101325.log`
- Result JSON: `.local/state/phase3b-smoke-result.json`
- Screenshot: none. The browser exited before a page object was available.

The latest blocker is:

```text
chrome_crashpad_handler: --database is required
```

The harness attempted these local mitigations:

- `--disable-crash-reporter`
- `--disable-crashpad`
- `--crash-dumps-dir=.local/tmp/phase3b-chromium-crash-dumps`
- `HOME=.local/chromium-home`
- `XDG_CONFIG_HOME=.local/chromium-home/.config`
- `XDG_CACHE_HOME=.local/chromium-home/.cache`
- Pre-created local Crashpad directories under `.local/chromium-home`

The same startup failure persisted.

## K. Go / No-Go 结论

No-Go for runtime validation in this managed environment.

Phase 3B successfully installed bundled Chromium and added a reproducible smoke harness, but it did not validate extension side-load, manual login, bridge messaging, or silent ZIP download. The blocker is bundled Chromium startup failure before the browser reaches a usable page.

## L. Phase 4 建议

Do not start Phase 4 until a browser runtime can launch reliably.

Recommended next options:

1. Run the Phase 3B harness from a normal terminal session outside this managed app environment.
2. Try a remote-debugging Chrome/Chromium instance launched manually with an automation-only profile and then connect Playwright to it.
3. Test whether an older Playwright Chromium build avoids the macOS Crashpad startup failure.
4. If a browser launches successfully outside this environment, rerun `phase3b:smoke` before implementing Phase 4 automation.

## Validation Commands

- `git status before`: clean; branch was ahead by Phase 2.5 and Phase 3 commits.
- `node -v`: `v24.14.0`
- `.local/bin/npm -v`: `11.6.4`
- `.local/bin/npm ls --depth=0`: `playwright@1.60.0`
- `PLAYWRIGHT_BROWSERS_PATH=/Users/one/chatgpt-backup-automation/.local/ms-playwright .local/bin/npm exec -- playwright --version`: `Version 1.60.0`
- `find .local/ms-playwright -maxdepth 3 -type f | head`: found local Chromium/headless shell files under `.local/ms-playwright`.
- `node --check app/phase3b-smoke-test.js`: passed.
- `.local/bin/npm run phase3b:smoke`: failed during bundled Chromium startup.
- `git status after`: recorded before commit.
