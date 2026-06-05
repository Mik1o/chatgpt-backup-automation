const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serviceWorker = fs.readFileSync(path.join(repoRoot, 'extension/chatgpt-backup/service-worker.js'), 'utf8');
const phase3cSmoke = fs.readFileSync(path.join(repoRoot, 'app/phase3c-cdp-smoke-test.js'), 'utf8');

assert.ok(
  serviceWorker.includes("const AUTOMATION_DOWNLOAD_DIRECTORY = 'ChatGPT_Backup_Staging';"),
  'service-worker should route automation downloads into the staging subdirectory through a relative downloads filename',
);

assert.ok(
  serviceWorker.includes('buildAutomationDownloadFilename(filename)'),
  'service-worker should build a Chrome downloads filename separate from the response basename',
);

assert.ok(
  serviceWorker.includes('chromeFilename'),
  'service-worker should pass the staged Chrome filename into chrome.downloads.download',
);

assert.ok(
  phase3cSmoke.includes("behavior: 'default'"),
  'phase3c smoke should reset CDP download behavior to Chrome default so downloads API filenames are honored',
);

assert.ok(
  !phase3cSmoke.includes('downloadPath: stagingDir'),
  'phase3c smoke should not set a CDP downloadPath because that makes Chrome ignore extension download filenames',
);

assert.ok(
  phase3cSmoke.includes("name: 'recent'"),
  'phase3c smoke should use an ASCII automation payload name for filename compatibility',
);

console.log('phase3c filename static checks passed');
