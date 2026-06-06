const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const phase4 = require('./phase4-run-once-backup');
const phase5 = require('./phase5-organize-archive');
const { acquireLock, releaseLock } = require('./lib/lock');
const { isRecentChatUrl, writeLastKnownRecent } = require('./lib/chrome-launcher');
const {
  PROJECT_ROOT,
  aggregateRunStatus,
  atomicWrite,
  createRunSummary,
  determineFailureStage,
  ensureDir,
  localTimestamp,
  runPreflight,
} = require('./lib/phase6');

function promptEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\nPress Enter to run one full backup, or Ctrl+C to abort.`, () => {
      rl.close();
      resolve();
    });
  });
}

async function run() {
  const runId = `phase6-run-${localTimestamp()}`;
  const stateDir = ensureDir(path.join(PROJECT_ROOT, '.local', 'state'));
  const logDir = ensureDir(path.join(PROJECT_ROOT, '.local', 'logs'));
  const summaryPath = path.join(stateDir, `run-once-summary-${runId}.json`);
  const logPath = path.join(logDir, `run-once-${runId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  let summary = createRunSummary({ runId, targetEmail: null, logPath });
  const lockPath = path.join(stateDir, 'run.lock');
  let lockOwner = null;
  let confirmedRecentUrl = null;

  const log = (message, meta = undefined) => {
    const line = `${new Date().toISOString()} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`;
    console.log(line);
    logStream.write(`${line}\n`);
  };

  try {
    const lock = acquireLock({ lockPath, mode: 'manual', runId });
    if (!lock.acquired) {
      summary.status = 'skipped_locked';
      summary.failureStage = 'lock';
      summary.error = 'Another project backup run is active';
      return { summary, summaryPath, logPath };
    }
    lockOwner = lock.owner;
    const preflight = await runPreflight({ requireCdp: true, requireChatGptPage: true, requirePing: true });
    summary.targetEmail = preflight.config?.target_email || null;
    summary.preflight = { status: preflight.status, checks: preflight.checks };
    if (preflight.status === 'failed') {
      summary.failureStage = 'preflight';
      throw new Error('Fatal preflight checks failed');
    }
    if (isRecentChatUrl(preflight.page?.url())) confirmedRecentUrl = preflight.page.url();

    await promptEnter([
      'Confirm in automation Chrome:',
      `1. You are logged into target ChatGPT account: ${preflight.config.target_email}`,
      '2. Current space is Personal',
      '3. UI language is English',
      '4. ChatGPT-Backup is loaded in chrome://extensions',
      '5. Current page is a recent chat, not a project chat',
    ].join('\n'));

    log('starting Phase 4 export workflow');
    const exported = await phase4.run({
      skipConfirmation: true,
      manageExitCode: false,
      cdpUrl: preflight.config.cdp_url,
      stagingDir: preflight.config.staging_dir,
    });
    summary.export = {
      status: exported.summary.status,
      summaryPath: exported.summaryPath,
      recent: exported.summary.recent,
      projects: exported.summary.projects,
      totals: exported.summary.totals,
    };
    summary.artifacts.stagingZips = [
      exported.summary.recent?.zipPath,
      ...exported.summary.projects.map((project) => project.zipPath),
    ].filter(Boolean);
    if (exported.summary.recent.status !== 'success') {
      summary.failureStage = 'export_recent';
      throw new Error(exported.summary.recent.error || 'Recent export failed');
    }

    log('starting Phase 5 organizer', { phase4SummaryPath: exported.summaryPath });
    const organized = await phase5.run({
      summaryPath: exported.summaryPath,
      manageExitCode: false,
      stagingDir: preflight.config.staging_dir,
    });
    summary.organize = {
      status: organized.summary.status,
      summaryPath: organized.summaryPath,
      archiveAccountRoot: organized.summary.archiveAccountRoot,
      totals: organized.summary.totals,
    };
    summary.artifacts.indexPath = organized.summary.indexPath || null;
    if (organized.summary.status === 'failed') {
      summary.failureStage = organized.summary.error?.includes('_index') ? 'index' : 'organize';
      throw new Error(organized.summary.error || 'Organizer failed');
    }

    summary.status = aggregateRunStatus({
      preflightStatus: summary.preflight.status,
      recentStatus: summary.export.recent.status,
      exportStatus: summary.export.status,
      organizeStatus: summary.organize.status,
    });
    if (!summary.failureStage) {
      summary.failureStage = determineFailureStage({
        preflightStatus: summary.preflight.status,
        recentStatus: summary.export.recent.status,
        exportStatus: summary.export.status,
        organizeStatus: summary.organize.status,
      });
    }
    if (summary.status === 'success' && confirmedRecentUrl) {
      writeLastKnownRecent(path.join(stateDir, 'last-known-chatgpt.json'), { recentUrl: confirmedRecentUrl, sourceRunId: runId });
    }
  } catch (error) {
    if (!summary.failureStage) summary.failureStage = 'preflight';
    summary.error = error.message || String(error);
    summary.status = 'failed';
    log('run:once failed', { failureStage: summary.failureStage, error: summary.error });
  } finally {
    summary.endedAt = new Date().toISOString();
    atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    log('run:once complete', { status: summary.status, failureStage: summary.failureStage, summaryPath });
    await new Promise((resolve) => logStream.end(resolve));
    if (lockOwner) releaseLock({ lockPath, owner: lockOwner });
    process.exitCode = summary.status === 'success' || summary.status === 'skipped_locked' ? 0 : summary.status === 'partial' ? 2 : 1;
  }
  return { summary, summaryPath, logPath };
}

module.exports = { run };

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.message || String(error));
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
}
