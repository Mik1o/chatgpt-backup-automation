const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SCHEDULE,
  evaluateScheduleGate,
  localDate,
  updateSchedulerState,
} = require('../app/lib/scheduler-state');
const { acquireLock, inspectLock, releaseLock } = require('../app/lib/lock');
const { buildNotification } = require('../app/lib/notify');
const { isRecentChatUrl } = require('../app/lib/chrome-launcher');
const { validateConfig } = require('../app/lib/phase6');
const { renderPlist } = require('../app/launchagent');
const { createScheduledSummary } = require('../app/run-scheduled');

const afterSchedule = new Date(2026, 5, 6, 10, 0, 0);
const beforeSchedule = new Date(2026, 5, 6, 9, 0, 0);
const today = localDate(afterSchedule);
const schedule = { ...DEFAULT_SCHEDULE };

assert.equal(evaluateScheduleGate({ now: beforeSchedule, schedule, state: {}, force: false }).status, 'skipped_before_schedule');
assert.equal(evaluateScheduleGate({ now: afterSchedule, schedule, state: {}, force: false }).status, 'run');
assert.equal(evaluateScheduleGate({ now: afterSchedule, schedule, state: { last_success_date: today }, force: false }).status, 'skipped_success_today');
assert.equal(evaluateScheduleGate({ now: afterSchedule, schedule, state: { last_success_date: today }, force: true }).status, 'run');
assert.equal(evaluateScheduleGate({ now: afterSchedule, schedule, state: { attempts_by_date: { [today]: 1 } }, force: false }).status, 'skipped_attempt_limit');

const succeeded = updateSchedulerState({}, { date: today, runId: 'run-1', status: 'success', countAttempt: true });
assert.equal(succeeded.last_success_date, today);
assert.equal(succeeded.attempts_by_date[today], 1);
const failed = updateSchedulerState({}, { date: today, runId: 'run-2', status: 'failed', countAttempt: true });
assert.equal(failed.last_success_date, null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase7-lock-'));
const lockPath = path.join(tmp, 'run.lock');
const active = acquireLock({ lockPath, mode: 'scheduled', runId: 'run-active', pid: 123, isPidAlive: () => true });
assert.equal(active.acquired, true);
assert.equal(inspectLock({ lockPath, isPidAlive: () => true }).status, 'active');
assert.equal(acquireLock({ lockPath, mode: 'manual', runId: 'run-blocked', isPidAlive: () => true }).status, 'skipped_locked');
releaseLock({ lockPath, owner: active.owner });
fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, started_at: new Date().toISOString(), mode: 'scheduled', run_id: 'old' }));
assert.equal(acquireLock({ lockPath, mode: 'scheduled', runId: 'new', isPidAlive: () => false }).acquired, true);

assert.deepEqual(buildNotification({ status: 'success', runId: 'run-1', zipCount: 5, markdownCount: 29 }), {
  title: 'ChatGPT Backup',
  message: 'Backup succeeded: 5 ZIPs, 29 Markdown, archive updated. Run: run-1',
});
assert.equal(buildNotification({ status: 'failed', runId: 'run-2', failureStage: 'preflight' }).message.includes('preflight'), true);

assert.equal(isRecentChatUrl('https://chatgpt.com/c/abc-123'), true);
assert.equal(isRecentChatUrl('https://chatgpt.com/g/project/c/abc-123'), false);
assert.equal(isRecentChatUrl('https://example.com/c/abc-123'), false);

const config = validateConfig({ target_email: 'person@example.com', archive_root: '/tmp/archive' });
assert.deepEqual(config.schedule, DEFAULT_SCHEDULE);

const plist = renderPlist();
assert.ok(plist.includes('com.local.chatgpt-backup-automation'));
assert.ok(plist.includes('<key>StartInterval</key>'));
assert.ok(plist.includes('<integer>1800</integer>'));
assert.ok(plist.includes('/Users/one/chatgpt-backup-automation/scripts/run-scheduled.sh'));
assert.equal(plist.includes('person@example.com'), false);

const summary = createScheduledSummary({ runId: 'scheduled-test', dryRun: true, force: false, noNotify: true });
assert.equal(summary.mode, 'scheduled');
assert.equal(summary.dryRun, true);
assert.ok(summary.gate && summary.lock && summary.preflight && summary.export && summary.organize && summary.artifacts);

const projectRoot = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const scheduledSource = fs.readFileSync(path.join(projectRoot, 'app/run-scheduled.js'), 'utf8');
const runOnceSource = fs.readFileSync(path.join(projectRoot, 'app/run-once.js'), 'utf8');
const launchagentSource = fs.readFileSync(path.join(projectRoot, 'app/launchagent.js'), 'utf8');
assert.ok(packageJson.scripts['run:scheduled']);
assert.ok(packageJson.scripts['launchagent:print-plist']);
assert.ok(packageJson.scripts['test:phase7-static']);
assert.equal(scheduledSource.includes('promptEnter'), false);
assert.ok(scheduledSource.includes('dryRun'));
assert.ok(scheduledSource.includes('acquireLock'));
assert.ok(runOnceSource.includes('acquireLock'));
assert.ok(launchagentSource.includes('0o022'));
assert.ok(launchagentSource.includes('schedulerState: readJsonIfPresent'));
assert.ok(scheduledSource.includes("summary.status === 'success'"));
assert.ok(runOnceSource.includes('writeLastKnownRecent'));
assert.equal(scheduledSource.includes('unlinkSync'), false);
assert.equal(scheduledSource.includes('browser.close'), false);

console.log('phase7 static checks passed');
