const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serviceWorker = fs.readFileSync(path.join(repoRoot, 'extension/chatgpt-backup/service-worker.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(repoRoot, 'extension/chatgpt-backup/scripts/content-script.js'), 'utf8');

function includesAll(source, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${label} missing: ${snippet}`);
  }
}

includesAll(serviceWorker, [
  'CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP',
  'buildAutomationZipFilename',
  'handleAutomationMarkdownZipExport',
  'saveAs: false',
  "payload.bucket === 'project'",
  "bucket !== 'project' && bucket !== 'recent'",
  'chatgpt-backup__${normalizedBucket}__${safeName}__${safeRunId}.zip',
], 'service-worker automation support');

includesAll(contentScript, [
  'CHATGPT_BACKUP_AUTOMATION',
  'EXPORT_MARKDOWN_ZIP',
  'EXPORT_MARKDOWN_ZIP_RESULT',
  'window.addEventListener("message"',
  'event.source !== window',
  'chatgpt.com',
], 'content-script automation bridge');

console.log('phase2 static checks passed');
