const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../extension/chatgpt-backup/jszip.js');

const {
  applyFrontmatter,
  assertWithin,
  buildArchiveDirectory,
  chooseArchiveFilename,
  determineOrganizerStatus,
  extractMarkdownEntries,
  makeWeakKey,
  sanitizePathSegment,
  updateIndex,
  validateSourceZipPath,
  yamlScalar,
} = require('../app/phase5-organize-archive');
const phase5Source = fs.readFileSync(path.join(__dirname, '..', 'app', 'phase5-organize-archive.js'), 'utf8');

assert.equal(sanitizePathSegment(' 数字枫桥/测试:项目 '), '数字枫桥_测试_项目');
assert.equal(sanitizePathSegment('   '), 'untitled');
assert.equal(sanitizePathSegment('长'.repeat(200)).length, 120);

assert.equal(yamlScalar('plain'), '"plain"');
assert.equal(yamlScalar('a: b\nc'), '"a: b\\nc"');
assert.equal(yamlScalar(null), 'null');

const replaced = applyFrontmatter('---\nsource: "chatgpt-backup"\nold: true\n---\n\nBody', { title: 'New' });
assert.match(replaced.content, /^---\ntitle: "New"\n---\n\nBody$/);
assert.equal(replaced.warning, null);

const preserved = applyFrontmatter('---\nsource: "other"\n---\n\nBody', { title: 'New' });
assert.match(preserved.content, /^---\ntitle: "New"\n---\n\n---\nsource: "other"/);
assert.ok(preserved.warning);

const root = '/tmp/archive@example.com';
assert.equal(buildArchiveDirectory(root, 'recent', null, '最近对话'), path.join(root, '最近对话'));
assert.equal(buildArchiveDirectory(root, 'project', '数字枫桥', '最近对话'), path.join(root, '数字枫桥'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-static-'));
fs.writeFileSync(path.join(tmp, 'Title.md'), 'one');
assert.equal(chooseArchiveFilename(tmp, 'Title', null, 'entry-a.md', 'content-a'), 'Title__entry-a.md');
assert.equal(chooseArchiveFilename(tmp, 'Title', 'conversation-12345678', 'entry-a.md', 'content-a'), 'Title__conversa.md');

assert.equal(
  makeWeakKey({ bucket: 'project', projectName: '数字枫桥', sourceEntry: 'Title.md' }),
  'project|数字枫桥|Title.md',
);

const existingIndex = {
  schema_version: 1,
  runs: [],
  conversations: [
    { conversation_id: 'id-1', weak_key: 'old', title: 'Old ID' },
    { conversation_id: null, weak_key: 'recent||weak.md', title: 'Old Weak' },
    { conversation_id: 'keep-me', weak_key: 'keep', title: 'Keep' },
  ],
};
const updated = updateIndex(existingIndex, {
  run: { backup_run_id: 'backup', organizer_run_id: 'organizer' },
  conversations: [
    { conversation_id: 'id-1', weak_key: 'new', title: 'Updated ID' },
    { conversation_id: null, weak_key: 'recent||weak.md', title: 'Updated Weak' },
  ],
});
assert.equal(updated.conversations.length, 3);
assert.equal(updated.conversations.find((item) => item.conversation_id === 'id-1').title, 'Updated ID');
assert.equal(updated.conversations.find((item) => item.weak_key === 'recent||weak.md').title, 'Updated Weak');
assert.ok(updated.conversations.find((item) => item.conversation_id === 'keep-me'));

assert.throws(() => assertWithin('/tmp/safe', '/tmp/escape'), /outside allowed root/);
assert.equal(assertWithin('/tmp/safe', '/tmp/safe/file.md'), '/tmp/safe/file.md');

assert.throws(
  () => validateSourceZipPath('/Users/one/Downloads/ChatGPT_Backup_Staging/download.zip'),
  /download.zip/,
);
assert.throws(
  () => validateSourceZipPath('/tmp/chatgpt-backup__recent__recent__run.zip'),
  /outside staging/,
);
assert.equal(
  validateSourceZipPath('/Users/one/Downloads/ChatGPT_Backup_Staging/chatgpt-backup__recent__recent__run.zip'),
  '/Users/one/Downloads/ChatGPT_Backup_Staging/chatgpt-backup__recent__recent__run.zip',
);

assert.equal(determineOrganizerStatus({ failedZips: 0, warnings: [], error: null }), 'success');
assert.equal(determineOrganizerStatus({ failedZips: 1, warnings: [], error: null }), 'partial');
assert.equal(determineOrganizerStatus({ failedZips: 0, warnings: ['warning'], error: null }), 'partial');
assert.equal(determineOrganizerStatus({ failedZips: 0, warnings: [], error: 'boom' }), 'failed');
assert.equal(determineOrganizerStatus({ failedZips: 0, warnings: [], error: 'Created config template at x' }), 'partial');

async function run() {
  const zip = new JSZip();
  zip.file('中文对话.md', '# 中文对话\n');
  zip.file('ignored.txt', 'ignored');
  const zipPath = path.join(tmp, 'unicode.zip');
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  const extracted = await extractMarkdownEntries(zipPath, path.join(tmp, 'extracted'));
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].sourceEntry, '中文对话.md');
  assert.equal(fs.readFileSync(extracted[0].path, 'utf8'), '# 中文对话\n');

  assert.ok(phase5Source.includes('identityPaths.get(identityKey)'), 'same identity should reuse one archive path within a run');
  assert.ok(phase5Source.includes("require('../extension/chatgpt-backup/jszip.js')"), 'organizer should use bundled JSZip');
  assert.equal(phase5Source.includes("execFileSync('unzip'"), false, 'organizer must not extract invalid ZIP filenames with system unzip');
  assert.ok(phase5Source.includes('Recent ZIP processing failed'), 'recent ZIP failure must stop index update');

  console.log('phase5 static checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
