const fs = require('node:fs');
const path = require('node:path');
const phase4 = require('./phase4-run-once-backup');
const phase5 = require('./phase5-organize-archive');
const { acquireLock, inspectLock, releaseLock } = require('./lib/lock');
const {
  ensureAutomationChrome,
  ensureRecentPage,
  loadLastKnownRecent,
  writeLastKnownRecent,
} = require('./lib/chrome-launcher');
const { buildNotification, sendNotification } = require('./lib/notify');
const {
  evaluateScheduleGate,
  loadSchedulerState,
  localDate,
  updateSchedulerState,
  writeSchedulerState,
} = require('./lib/scheduler-state');
const {
  PROJECT_ROOT,
  aggregateRunStatus,
  atomicWrite,
  ensureDir,
  loadConfig,
  localTimestamp,
  runPreflight,
} = require('./lib/phase6');

const STATE_DIR = path.join(PROJECT_ROOT, '.local', 'state');
const LOG_DIR = path.join(PROJECT_ROOT, '.local', 'logs');
const LOCK_PATH = path.join(STATE_DIR, 'run.lock');
const SCHEDULER_STATE_PATH = path.join(STATE_DIR, 'scheduler-state.json');
const LAST_KNOWN_PATH = path.join(STATE_DIR, 'last-known-chatgpt.json');

function parseArgs(argv) {
  return {
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    noNotify: argv.includes('--no-notify'),
    json: argv.includes('--json'),
  };
}

function createScheduledSummary({ runId, dryRun, force, noNotify }) {
  return {
    runId,
    mode: 'scheduled',
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'failed',
    failureStage: null,
    force,
    dryRun,
    noNotify,
    gate: { status: 'pending', reason: null },
    lock: { status: 'pending', warnings: [] },
    chrome: { reachable: false, started: false },
    recent: { url: null, source: null },
    preflight: { status: 'pending', checks: [] },
    export: { status: 'pending', summaryPath: null, recent: {}, projects: [], totals: {} },
    organize: { status: 'pending', summaryPath: null, archiveAccountRoot: null, totals: {} },
    notification: { attempted: false, ok: null, error: null },
    artifacts: { logPath: null, summaryPath: null, schedulerStatePath: SCHEDULER_STATE_PATH, lockPath: LOCK_PATH, indexPath: null, stagingZips: [] },
    warnings: [],
    error: null,
  };
}

function shouldNotify(schedule, status) {
  if (status === 'success') return schedule.notify_success;
  if (status === 'partial') return schedule.notify_partial;
  if (status === 'failed') return schedule.notify_failure;
  return schedule.notify_skipped;
}

async function run(options = parseArgs(process.argv.slice(2))) {
  ensureDir(STATE_DIR);
  ensureDir(LOG_DIR);
  const runId = `phase7-scheduled-${localTimestamp()}`;
  const summaryPath = path.join(STATE_DIR, `run-scheduled-summary-${runId}.json`);
  const logPath = path.join(LOG_DIR, `run-scheduled-${runId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const summary = createScheduledSummary({ runId, ...options });
  summary.artifacts.logPath = logPath;
  summary.artifacts.summaryPath = summaryPath;
  let lockOwner = null;
  let config = null;
  let date = localDate();
  let schedulerState = {};

  const log = (message, meta = undefined) => {
    const line = `${new Date().toISOString()} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`;
    if (!options.json) console.log(line);
    logStream.write(`${line}\n`);
  };

  try {
    config = loadConfig();
    schedulerState = loadSchedulerState(SCHEDULER_STATE_PATH);
    const gate = evaluateScheduleGate({ schedule: config.schedule, state: schedulerState, force: options.force });
    date = gate.date;
    summary.gate = gate;

    if (options.dryRun) {
      const lock = inspectLock({ lockPath: LOCK_PATH });
      summary.lock = { status: lock.status, warnings: lock.warnings };
      const known = loadLastKnownRecent(LAST_KNOWN_PATH);
      summary.recent = { url: known?.recent_url || null, source: known ? 'last_known' : null };
      const preflight = await runPreflight();
      summary.preflight = { status: preflight.status, checks: preflight.checks };
      summary.chrome.reachable = preflight.checks.find((check) => check.name === 'cdp')?.status === 'success';
      summary.status = preflight.status === 'failed' ? 'failed' : 'success';
      if (summary.status === 'failed') summary.failureStage = 'preflight';
      return summary;
    }

    if (gate.status !== 'run') {
      summary.status = gate.status;
      return summary;
    }

    const lock = acquireLock({ lockPath: LOCK_PATH, mode: 'scheduled', runId });
    summary.lock = { status: lock.status, warnings: lock.warnings };
    summary.warnings.push(...lock.warnings);
    if (!lock.acquired) {
      summary.status = 'skipped_locked';
      return summary;
    }
    lockOwner = lock.owner;
    schedulerState = updateSchedulerState(schedulerState, { date, runId, status: 'running', countAttempt: true });
    writeSchedulerState(SCHEDULER_STATE_PATH, schedulerState);

    const known = loadLastKnownRecent(LAST_KNOWN_PATH);
    const chrome = await ensureAutomationChrome(config, {
      allowStart: true,
      initialUrl: known?.recent_url || 'https://chatgpt.com/',
    });
    summary.chrome = chrome;
    if (!chrome.reachable) {
      summary.failureStage = 'preflight';
      throw new Error(chrome.error || 'Automation Chrome CDP is unavailable');
    }

    const prepared = await ensureRecentPage(config, { statePath: LAST_KNOWN_PATH });
    summary.recent = { url: prepared.recentUrl, source: known?.recent_url === prepared.recentUrl ? 'last_known' : 'open_page' };
    const preflight = await runPreflight({ requireCdp: true, requireChatGptPage: true, requirePing: true });
    summary.preflight = { status: preflight.status, checks: preflight.checks };
    if (preflight.status === 'failed') {
      summary.failureStage = 'preflight';
      throw new Error('Fatal scheduled preflight checks failed');
    }

    log('starting scheduled Phase 4 export');
    const exported = await phase4.run({
      skipConfirmation: true,
      manageExitCode: false,
      cdpUrl: config.cdp_url,
      stagingDir: config.staging_dir,
    });
    summary.export = {
      status: exported.summary.status,
      summaryPath: exported.summaryPath,
      recent: exported.summary.recent,
      projects: exported.summary.projects,
      totals: exported.summary.totals,
    };
    summary.artifacts.stagingZips = [exported.summary.recent?.zipPath, ...exported.summary.projects.map((project) => project.zipPath)].filter(Boolean);
    if (exported.summary.recent.status !== 'success') {
      summary.failureStage = 'export_recent';
      throw new Error(exported.summary.recent.error || 'Recent export failed');
    }

    log('starting scheduled Phase 5 organizer');
    const organized = await phase5.run({ summaryPath: exported.summaryPath, manageExitCode: false, stagingDir: config.staging_dir });
    summary.organize = {
      status: organized.summary.status,
      summaryPath: organized.summaryPath,
      archiveAccountRoot: organized.summary.archiveAccountRoot,
      totals: organized.summary.totals,
    };
    summary.artifacts.indexPath = organized.summary.indexPath || null;
    if (organized.summary.status === 'failed') {
      summary.failureStage = 'organize';
      throw new Error(organized.summary.error || 'Organizer failed');
    }
    summary.status = aggregateRunStatus({
      preflightStatus: summary.preflight.status,
      recentStatus: summary.export.recent.status,
      exportStatus: summary.export.status,
      organizeStatus: summary.organize.status,
    });
    if (summary.status === 'partial') summary.failureStage = summary.export.status === 'partial' ? 'export_project' : 'organize';
    if (summary.status === 'success') writeLastKnownRecent(LAST_KNOWN_PATH, { recentUrl: prepared.recentUrl, sourceRunId: runId });
  } catch (error) {
    summary.status = 'failed';
    summary.failureStage = summary.failureStage || 'preflight';
    summary.error = error.message || String(error);
    log('scheduled run failed', { failureStage: summary.failureStage, error: summary.error });
  } finally {
    summary.endedAt = new Date().toISOString();
    if (!options.dryRun && config) {
      schedulerState = updateSchedulerState(schedulerState, { date, runId, status: summary.status, countAttempt: false });
      writeSchedulerState(SCHEDULER_STATE_PATH, schedulerState);
      if (!options.noNotify && shouldNotify(config.schedule, summary.status)) {
        summary.notification.attempted = true;
        const notification = buildNotification({
          status: summary.status,
          runId,
          failureStage: summary.failureStage,
          zipCount: summary.export.totals.zipCount || summary.organize.totals.zipsProcessed || 0,
          markdownCount: summary.export.totals.mdCount || summary.organize.totals.markdownWritten || 0,
        });
        const notified = sendNotification(notification);
        summary.notification = { attempted: true, ...notified };
        if (!notified.ok) summary.warnings.push(`Notification failed: ${notified.error}`);
      }
    }
    atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    if (lockOwner) releaseLock({ lockPath: LOCK_PATH, owner: lockOwner });
    await new Promise((resolve) => logStream.end(resolve));
    if (options.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = summary.status === 'failed' ? 1 : 0;
  }
  return summary;
}

module.exports = { createScheduledSummary, parseArgs, run, shouldNotify };

if (require.main === module) {
  run().finally(() => process.exit(process.exitCode || 0));
}
