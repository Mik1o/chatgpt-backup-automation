# Phase 2 Extension Automation

## Scope

本阶段只修改本地扩展源码，新增自动化专用导出入口。未启动 Chrome，未登录 ChatGPT，未执行真实导出，未写完整 Playwright 自动化，未创建 LaunchAgent。

## A. 修改摘要

- 新增自动化 runtime message: `CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP`。
- 新增 `chatgpt.com` 页面内 `window.postMessage` bridge，由 content script 转发到 service worker。
- 扩展 `saveAs()`，保留手动路径默认 `saveAs: true`，自动化路径传入 `saveAs: false`。
- 自动化路径强制输出 ZIP 文件，即使导出结果只有一个会话。
- 新增静态 debug 页面，用于后续阶段查看 bridge protocol。
- 添加 `tests/phase2-static.test.js`，在不安装 npm 的前提下用 Node 验证关键静态约束。

## B. 修改过的文件列表

- `extension/chatgpt-backup/service-worker.js`
- `extension/chatgpt-backup/scripts/content-script.js`
- `extension/chatgpt-backup/debug/debug.html`
- `extension/chatgpt-backup/debug/debug.js`
- `docs/phase-2-extension-automation.md`
- `tests/phase2-static.test.js`

## C. 新增 message protocol

Page to content script:

```js
window.postMessage({
  source: 'CHATGPT_BACKUP_AUTOMATION',
  type: 'EXPORT_MARKDOWN_ZIP',
  requestId: '...',
  payload: {
    bucket: 'project',
    name: 'Example Project',
    backupRunId: '2026-06-01_093000',
  },
}, window.location.origin);
```

Content script to service worker:

```js
chrome.runtime.sendMessage({
  message: 'CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP',
  requestId: '...',
  payload: {
    bucket: 'project',
    name: 'Example Project',
    backupRunId: '2026-06-01_093000',
  },
});
```

Content script back to page:

```js
{
  source: 'CHATGPT_BACKUP_EXTENSION',
  type: 'EXPORT_MARKDOWN_ZIP_RESULT',
  requestId: '...',
  ok: true,
  result: {
    filename: 'chatgpt-backup__project__Example Project__2026-06-01_093000.zip',
    bucket: 'project',
    name: 'Example Project',
    backupRunId: '2026-06-01_093000',
    downloadId: 123,
  },
}
```

Failure response uses the same response envelope with `ok: false` and `error`.

## D. 自动化 ZIP filename 规则

Automation filename format:

```text
chatgpt-backup__<bucket>__<sanitized-name>__<backup-run-id>.zip
```

Rules:

- `bucket` must be `project` or `recent`.
- Unsafe characters `/ \ : * ? " < > |` and control characters are replaced through the existing filename sanitizer.
- Whitespace is normalized.
- Name length is limited before composing the full filename.
- Empty project name falls back to `project`.
- Empty recent name falls back to `最近对话`.
- The rule is used only by automation calls through `CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP`.

## E. `saveAs` true/false 行为说明

- Manual popup calls continue to call `downloadMarkdownZip()` without download options, so `saveAs()` defaults to `saveAs: true`.
- Automation calls pass `{ filename, forceZip: true, saveAs: false }`.
- The extension still uses `chrome.downloads.download()` and the existing `downloads` permission.
- The extension does not set an absolute path and does not alter Chrome's default download directory.

## F. 手动 popup UI 是否保持兼容

- `popup/popup.html` and `popup/popup.js` were not modified.
- Existing message types such as `backUpAllAsMARKDOWN` and `backUpCurrentProject` are preserved.
- Manual Markdown export keeps the existing prompt behavior because the default `saveAs` option remains true.
- Manual single-chat Markdown export still produces a single Markdown file as before; automation uses `forceZip`.

## G. content-script bridge 安全限制

- The bridge only accepts `message` events where `event.source === window`.
- The bridge requires `event.origin === window.location.origin`.
- The bridge only runs commands when `window.location.hostname` is `chatgpt.com` or `www.chatgpt.com`.
- The bridge validates `source`, `type`, `requestId`, and payload shape.
- Unknown buckets are rejected.
- The bridge returns only metadata: `filename`, `bucket`, `name`, `backupRunId`, `downloadId`, and errors. It does not post chat content back into the page.
- No `externally_connectable` setting or extra host permission was added.
- The service worker also validates the sender URL before running the automation export.

## H. debug 页面使用说明

- Debug page files:
  - `extension/chatgpt-backup/debug/debug.html`
  - `extension/chatgpt-backup/debug/debug.js`
- The page is static and documents expected request/response shapes.
- It does not require new permissions.
- In a later Chrome test profile, open the extension page directly from the loaded unpacked extension to inspect the protocol.

## I. 静态验证结果

- `git status before`: clean on `main` before Phase 2 edits.
- TDD red check: `node tests/phase2-static.test.js` initially failed because `CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP` was absent.
- TDD green check: `node tests/phase2-static.test.js` passed with `phase2 static checks passed`.
- `git diff --check`: passed with no output.
- `node --check extension/chatgpt-backup/service-worker.js`: passed.
- `node --check extension/chatgpt-backup/scripts/content-script.js`: passed.
- `node --check extension/chatgpt-backup/debug/debug.js`: passed.
- `node --check tests/phase2-static.test.js`: passed.
- `rg "CHATGPT_BACKUP_AUTOMATION" extension/chatgpt-backup`: found the bridge/debug/service-worker constants.
- `rg "saveAs: false|saveAs\\s*=\\s*false|saveAs\\(" extension/chatgpt-backup`: found the automation `saveAs: false` calls and existing shared `saveAs()` call sites.
- `rg "chrome.downloads.download" extension/chatgpt-backup`: found the single shared download call in `service-worker.js`.
- `git ls-files .local`: no output; `.local/` is not tracked.
- `find extension/chatgpt-backup -name .git -print`: no output; no nested extension Git repository.
- `test -f docs/phase-2-extension-automation.md`: passed.

## J. 后续 Phase 3 需要验证的事项

- Load the unpacked extension only in a dedicated Chrome test profile.
- Confirm the page bridge can be triggered by Playwright from a `chatgpt.com` page context.
- Confirm `sender.url` / `sender.tab.url` validation works in real extension runtime.
- Confirm project export works against real project URLs and current ChatGPT DOM.
- Confirm silent ZIP download lands in the expected default/staging download directory.
- Confirm download completion through `chrome.downloads.onChanged` and filesystem polling.
- Confirm no chat content is exposed in page bridge responses or persistent logs.
