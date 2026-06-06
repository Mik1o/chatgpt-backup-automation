const assert = require('node:assert/strict');

const {
  aggregateStatus,
  buildExpectedZipFilename,
  isAcceptedZipFilename,
  sanitizeFilename,
  validateBucket,
} = require('../app/phase4-run-once-backup');
const fs = require('node:fs');
const path = require('node:path');
const phase4Source = fs.readFileSync(path.join(__dirname, '..', 'app', 'phase4-run-once-backup.js'), 'utf8');

assert.equal(sanitizeFilename(' 数字枫桥 / 测试:*? '), '数字枫桥 _ 测试___');
assert.equal(sanitizeFilename('   '), 'untitled');
assert.equal(sanitizeFilename('a'.repeat(200)).length, 120);

assert.equal(
  buildExpectedZipFilename('recent', 'recent', 'phase4-run-2026-06-06_120000'),
  'chatgpt-backup__recent__recent__phase4-run-2026-06-06_120000.zip',
);
assert.equal(
  buildExpectedZipFilename('project', '数字枫桥', 'phase4-run-2026-06-06_120000'),
  'chatgpt-backup__project__数字枫桥__phase4-run-2026-06-06_120000.zip',
);

assert.equal(isAcceptedZipFilename('download.zip', 'chatgpt-backup__recent__recent__run.zip'), false);
assert.equal(
  isAcceptedZipFilename('chatgpt-backup__recent__recent__run.zip', 'chatgpt-backup__recent__recent__run.zip'),
  true,
);

assert.equal(validateBucket('recent'), 'recent');
assert.equal(validateBucket('project'), 'project');
assert.throws(() => validateBucket('all'), /Invalid bucket/);

assert.equal(aggregateStatus({ recentStatus: 'failed', projectStatuses: [] }), 'failed');
assert.equal(aggregateStatus({ recentStatus: 'success', projectStatuses: [] }), 'success');
assert.equal(aggregateStatus({ recentStatus: 'success', projectStatuses: ['success', 'skipped_empty'] }), 'success');
assert.equal(aggregateStatus({ recentStatus: 'success', projectStatuses: ['failed'] }), 'partial');

assert.equal(
  phase4Source.includes("document.body?.innerText"),
  false,
  'health checks must not scan ChatGPT conversation body text',
);

assert.equal(
  phase4Source.includes("row?.querySelector('[data-sidebar-item=\"true\"]')"),
  true,
  'project navigation must expand the named project sidebar row',
);

assert.equal(
  phase4Source.includes("row?.querySelectorAll('a[href]')"),
  true,
  'project navigation must select conversations only from the matching project row',
);

console.log('phase4 static checks passed');
