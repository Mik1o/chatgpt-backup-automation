const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  NO_DELETION_POLICY,
  aggregateRunStatus,
  buildPingRequest,
  createRunSummary,
  determineFailureStage,
  doctorExitCode,
  summarizeChecks,
  validateConfig,
} = require('../app/lib/phase6');

const projectRoot = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const contentScript = fs.readFileSync(path.join(projectRoot, 'extension/chatgpt-backup/scripts/content-script.js'), 'utf8');
const doctorSource = fs.readFileSync(path.join(projectRoot, 'app/doctor.js'), 'utf8');
const runOnceSource = fs.readFileSync(path.join(projectRoot, 'app/run-once.js'), 'utf8');
const phase4 = require('../app/phase4-run-once-backup');
const phase5 = require('../app/phase5-organize-archive');

assert.throws(
  () => validateConfig({ target_email: 'REPLACE_WITH_TARGET_CHATGPT_EMAIL', archive_root: '/tmp/archive' }),
  /target_email/,
);
assert.equal(validateConfig({
  target_email: 'person@example.com',
  archive_root: '/tmp/archive',
}).target_email, 'person@example.com');

assert.deepEqual(summarizeChecks([
  { status: 'success' },
  { status: 'warning' },
]), { status: 'warning', fatalCount: 0, warningCount: 1 });
assert.deepEqual(summarizeChecks([
  { status: 'warning' },
  { status: 'fatal' },
]), { status: 'failed', fatalCount: 1, warningCount: 1 });
assert.equal(doctorExitCode([{ status: 'warning' }]), 0);
assert.equal(doctorExitCode([{ status: 'fatal' }]), 1);

assert.equal(aggregateRunStatus({ preflightStatus: 'success', recentStatus: 'success', exportStatus: 'success', organizeStatus: 'success' }), 'success');
assert.equal(aggregateRunStatus({ preflightStatus: 'warning', recentStatus: 'success', exportStatus: 'success', organizeStatus: 'success' }), 'success');
assert.equal(aggregateRunStatus({ preflightStatus: 'warning', recentStatus: 'success', exportStatus: 'partial', organizeStatus: 'success' }), 'partial');
assert.equal(aggregateRunStatus({ preflightStatus: 'failed', recentStatus: 'pending', exportStatus: 'pending', organizeStatus: 'pending' }), 'failed');
assert.equal(aggregateRunStatus({ preflightStatus: 'success', recentStatus: 'failed', exportStatus: 'failed', organizeStatus: 'pending' }), 'failed');
assert.equal(determineFailureStage({ preflightStatus: 'failed', recentStatus: 'pending', exportStatus: 'pending', organizeStatus: 'pending' }), 'preflight');
assert.equal(determineFailureStage({ preflightStatus: 'success', recentStatus: 'failed', exportStatus: 'failed', organizeStatus: 'pending' }), 'export_recent');
assert.equal(determineFailureStage({ preflightStatus: 'success', recentStatus: 'success', exportStatus: 'partial', organizeStatus: 'success' }), 'export_project');
assert.equal(determineFailureStage({ preflightStatus: 'success', recentStatus: 'success', exportStatus: 'success', organizeStatus: 'partial' }), 'organize');

const ping = buildPingRequest('request-1');
assert.deepEqual(ping, {
  source: 'CHATGPT_BACKUP_AUTOMATION',
  type: 'PING',
  requestId: 'request-1',
});

const summary = createRunSummary({
  runId: 'phase6-run-test',
  targetEmail: 'person@example.com',
  logPath: '/tmp/run.log',
});
assert.equal(summary.runId, 'phase6-run-test');
assert.equal(summary.targetEmail, 'person@example.com');
assert.equal(summary.status, 'failed');
assert.ok(summary.preflight && summary.export && summary.organize && summary.artifacts);

assert.deepEqual(NO_DELETION_POLICY, {
  deleteStagingZips: false,
  deleteOldArchiveMarkdown: false,
  deleteUnseenArchiveRecords: false,
});

assert.equal(packageJson.scripts.doctor, '/Applications/Codex.app/Contents/Resources/node app/doctor.js');
assert.equal(packageJson.scripts['run:once'], '/Applications/Codex.app/Contents/Resources/node app/run-once.js');
assert.equal(packageJson.scripts['test:phase6-static'], '/Applications/Codex.app/Contents/Resources/node tests/phase6-static.test.js');
assert.equal(typeof phase4.run, 'function');
assert.equal(typeof phase5.run, 'function');

assert.ok(contentScript.includes('AUTOMATION_PING_TYPE'));
assert.ok(contentScript.includes('AUTOMATION_PING_RESULT_TYPE'));
assert.ok(contentScript.includes('extension: "ChatGPT-Backup"'));
assert.ok(doctorSource.includes('doctor-summary-'));
assert.ok(runOnceSource.includes('run-once-summary-'));
assert.ok(runOnceSource.includes('skipConfirmation: true'));
assert.ok(runOnceSource.includes('cdpUrl: preflight.config.cdp_url'));
assert.ok(runOnceSource.includes('stagingDir: preflight.config.staging_dir'));
assert.equal(runOnceSource.includes('unlinkSync'), false);
assert.equal(runOnceSource.includes('rmSync'), false);

console.log('phase6 static checks passed');
