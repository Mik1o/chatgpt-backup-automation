# Phase 1 Source Audit

## Scope

本阶段只完成项目初始化、源码获取和可行性审计。未启动 Chrome，未访问 ChatGPT 登录态，未加载扩展，未修改扩展导出逻辑，未创建 LaunchAgent。

## Environment

- `uname -a`: `Darwin zhangyifeideMacBook-Air-3.local 24.6.0 Darwin Kernel Version 24.6.0: Mon Aug 11 21:16:30 PDT 2025; root:xnu-11417.140.69.701.11~1/RELEASE_ARM64_T8132 arm64`
- `git --version`: `git version 2.50.1 (Apple Git-155)`
- `node -v`: `v24.14.0`
- `npm -v`: `missing` (`zsh:1: command not found: npm`)

## Source Acquisition

- Source URL: `https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION`
- Source commit hash: `4df83c9c87ee831bb1cb2ad65ed64533e9185969`
- Clone time: `2026-06-01T07:00:20Z`
- Temporary clone path: `.local/source-cache/ChatGPT-CHROME_EXTENSION`
- Copied source path: `extension/chatgpt-backup/`
- Copy detail: copied the upstream `CHROME_EXTENSION/` directory only. The upstream `.git` directory was not copied into `extension/chatgpt-backup/`.
- Pre-existing destination: `extension/chatgpt-backup/` did not exist before copying.

## A. 源码基本信息

- `manifest.json`: `extension/chatgpt-backup/manifest.json`
- `manifest_version`: `3`
- Extension name: `ChatGPT-Backup`
- Extension version: `0.1.1`
- `version_name`: `stable`
- `permissions`: `tabs`, `downloads`, `storage`
- `host_permissions`: `https://chatgpt.com/*`
- `content_scripts`: `scripts/content-script.js`, matched on `https://chatgpt.com/*`, `run_at: document_end`
- Background service worker: `service-worker.js`
- Popup UI: `popup/popup.html`, `popup/popup.js`
- Options UI: `options/options.html`, `options/options.js`
- ZIP library: `jszip.js`
- `popup/FileSaver.js`: not present in this source tree.

## B. Markdown ZIP 导出流程

- Markdown 渲染主要在 `extension/chatgpt-backup/service-worker.js`:
  - `applyContentReferences()` around lines 132-146 converts ChatGPT content references into markdown-friendly text.
  - `enrichMessage()` around lines 149-163 stores `rendered_markdown`.
  - `parseConversation()` around lines 173-249 normalizes raw conversation mapping into user/assistant messages.
  - `applyMdxFrontmatter()` around lines 1058-1065 optionally adds MDX frontmatter.
  - `jsonToMarkdown()` around lines 1138-1170 serializes normalized chat messages into Markdown.
- ZIP generation is in `downloadMarkdownZip()` around lines 1104-1137:
  - For one chat it writes a single `.md` / `.mdx` file through `saveAs()`.
  - For multiple chats it creates `new JSZip()`, writes one markdown file per chat, generates base64 ZIP content, then calls `saveAs(content, 'application/zip', ...)`.
- `Backup all chats as -> MARKDOWN` likely maps to:
  - UI button `download-as-markdown` in `popup/popup.html` lines 231-237.
  - `allMarkdownButton` click handler in `popup/popup.js` lines 134-140.
  - Runtime message `backUpAllAsMARKDOWN` in `service-worker.js` lines 738-761.
  - Fetch path `main()` / `getAllConversations()` and output path `downloadMarkdownZip()`.
- `Backup current project as -> MARKDOWN` likely maps to:
  - UI button `download-current-project-as-markdown` in `popup/popup.html` lines 241-247.
  - `currentProjectMarkdownButton` click handler in `popup/popup.js` lines 203-208.
  - Runtime message `backUpCurrentProject` with `downloadType: 'markdown'` in `service-worker.js` lines 775-842.
  - Project branch calls `getProjectConversationIdsFromTab()`, filters/normalizes project conversations, then calls `downloadMarkdownZip()` at lines 827-830.
- Project vs recent/all chats are separated by:
  - Popup URL detection in `popup/popup.js` lines 76-83 toggles project UI when active URL matches `https://chatgpt.com/g/g-p-.../c/...`.
  - Service worker message handlers: `backUpAllAsMARKDOWN` handles all/recent chats; `backUpCurrentProject` handles current project.
  - Content script `getProjectConversationIdsFromDom()` in `scripts/content-script.js` lines 12-26 extracts project conversation IDs from anchors under the current project slug.

## C. 保存弹窗来源

- 保存弹窗 is most likely triggered by `chrome.downloads.download({ saveAs: true })` in `extension/chatgpt-backup/service-worker.js` lines 650-655.
- The function name is `saveAs()`, but this is a local helper, not `FileSaver.saveAs`.
- No `popup/FileSaver.js` file exists in the copied source.
- `downloadMarkdownZip()`, `downloadJson()`, and `downloadRawJson()` all route through the same local `saveAs()` helper:
  - Markdown ZIP/single Markdown: `downloadMarkdownZip()` lines 1104-1137.
  - JSON: `downloadJson()` lines 1171-1179.
  - Raw JSON: `downloadRawJson()` lines 1182-1189.
- For ZIP files, the helper passes a base64 `data:application/zip` URL to `chrome.downloads.download()`.
- Therefore the save dialog is not coming from browser anchor-click behavior; it is the explicit `saveAs: true` download option.

## D. 无弹窗自动下载可行性

- Feasibility: Go. The current architecture already uses `chrome.downloads.download()`.
- Recommended minimal Phase 2 change:
  - Keep the existing `saveAs()` helper but add an option or sibling helper for automation downloads.
  - For automated ZIP export, call `chrome.downloads.download({ url, filename, saveAs: false })`.
  - Use a deterministic relative `filename`, for example under a fixed prefix such as `chatgpt-backup/gpt-backup-<timestamp>.zip`, so Chrome writes to the configured default downloads directory.
  - Preserve popup behavior by keeping current manual popup calls on `saveAs: true`, unless the user explicitly decides manual popup should also become silent.
- Permission impact:
  - `downloads` permission already exists in `manifest.json`.
  - No new permission is required for silent downloads to the default downloads directory.
  - Avoid broadening `host_permissions`; keep `https://chatgpt.com/*`.
  - A later debug page can be added as an extension page without host permission expansion.

## E. 自动化入口可行性

- Feasibility: Go, with runtime messaging.
- The existing content script already receives extension messages and runs on `https://chatgpt.com/*`.
- Recommended bridge approach for Phase 2:
  - Add a narrow content-script bridge in `scripts/content-script.js`.
  - Let Playwright execute code in the ChatGPT page that dispatches a local `window.postMessage()` or `CustomEvent`.
  - The content script validates origin and command shape, then calls `chrome.runtime.sendMessage()` to the service worker.
  - The service worker reuses existing handlers or shared functions for `backUpCurrentProject` / markdown export.
- Recommended service-worker entry point:
  - Add a new message type rather than changing popup message contracts.
  - Internally reuse the same `downloadMarkdownZip()`, project ID extraction, token loading, progress, and cancellation paths.
- `debug.html`:
  - Not required for the minimal bridge, but feasible as a later extension page.
  - It should call `chrome.runtime.sendMessage()` directly and display logs/state without changing popup UI.
- Keeping popup UI intact:
  - Do not alter `popup/popup.html` button IDs or existing `popup/popup.js` message payloads.
  - Add automation-specific message paths and download options in parallel.

## F. 风险和未知数

- GitHub source may not exactly match the Chrome Web Store build.
- ChatGPT page URLs and DOM may change, especially project URL format and sidebar anchor structure.
- `conversation_id` extraction may fail for new URL formats or unsaved chats.
- Project membership filtering depends on identifiers such as `gizmo_id`, `conversation_template_id`, `project_id`, or DOM-derived IDs; stability must be tested against real project chats later.
- Token loading depends on `https://chatgpt.com/api/auth/session` and ChatGPT backend API behavior.
- Download completion should be validated via `chrome.downloads.onChanged` plus Playwright/file-system polling in a controlled download directory.
- Large archives may hit practical limits when ZIP content is held as base64 data URL.
- Current source has verbose `console.log()` of conversation data; later phases should review log hygiene before production automation.

## G. Go / No-Go 结论

- Source-level Phase 2 readiness: Go.
- Phase 2 can start after Phase 1 repository/commit verification passes.
- Recommended minimal Phase 2 goal:
  - Add an automation-only runtime message for current-project Markdown ZIP export.
  - Add a content-script bridge callable from Playwright on `chatgpt.com`.
  - Make only automation-triggered ZIP downloads silent with `saveAs: false`.
  - Preserve existing popup manual UI and current manual save-dialog behavior.
- No source-level blocker was found for the requested later modifications.

## Validation Results

- `git status`: repository initialized on `main`; project files were untracked before commit.
- `find . -maxdepth 3 -type f | sort`: returned the expected project files at this depth: `.gitignore`, `docs/README.md`, `docs/phase-1-source-audit.md`, and top-level files under `extension/chatgpt-backup/`.
- `.local/` ignored by `.gitignore`: yes, `.gitignore` contains `.local/`.
- Nested extension git directory: none found under `extension/chatgpt-backup/`.
- Audit document A-G sections: present.
- Commit: ready after validation.
