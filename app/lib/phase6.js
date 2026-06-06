const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = '/Users/one/chatgpt-backup-automation';
const CONFIG_PATH = path.join(PROJECT_ROOT, '.local', 'config.json');
const TEMPLATE_EMAIL = 'REPLACE_WITH_TARGET_CHATGPT_EMAIL';
const DEFAULTS = {
  archive_root: '/Users/one/Documents/ChatGPT_Backups',
  recent_bucket_name: '最近对话',
  cdp_url: 'http://127.0.0.1:9222',
  staging_dir: '/Users/one/Downloads/ChatGPT_Backup_Staging',
  chrome_user_data_dir: path.join(PROJECT_ROOT, '.local', 'chrome-user-data-cdp'),
};
const DEFAULT_SCHEDULE = {
  enabled: true,
  target_hour: 9,
  target_minute: 30,
  check_interval_minutes: 30,
  max_scheduled_attempts_per_day: 1,
  allow_auto_start_chrome: true,
  notify_success: true,
  notify_partial: true,
  notify_failure: true,
  notify_skipped: false,
};
const LOCAL_DIRS = ['logs', 'state', 'screenshots', 'tmp'].map((name) => path.join(PROJECT_ROOT, '.local', name));
const START_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'start-cdp-chrome.sh');
const NO_DELETION_POLICY = Object.freeze({
  deleteStagingZips: false,
  deleteOldArchiveMarkdown: false,
  deleteUnseenArchiveRecords: false,
});

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function validateConfig(input) {
  const config = { ...DEFAULTS, ...input, schedule: { ...DEFAULT_SCHEDULE, ...(input.schedule || {}) } };
  if (!config.target_email || config.target_email === TEMPLATE_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.target_email)) {
    throw new Error('Invalid target_email in .local/config.json');
  }
  for (const key of ['archive_root', 'staging_dir', 'chrome_user_data_dir']) {
    if (!config[key] || !path.isAbsolute(config[key])) throw new Error(`${key} must be an absolute path`);
  }
  if (!/^https?:\/\/127\.0\.0\.1:\d+\/?$/.test(config.cdp_url)) {
    throw new Error('cdp_url must use 127.0.0.1 with an explicit port');
  }
  if (!config.recent_bucket_name) config.recent_bucket_name = DEFAULTS.recent_bucket_name;
  return config;
}

function loadConfig(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) throw new Error(`Missing config: ${configPath}`);
  return validateConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
}

function summarizeChecks(checks) {
  const fatalCount = checks.filter((check) => check.status === 'fatal').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  return {
    status: fatalCount ? 'failed' : warningCount ? 'warning' : 'success',
    fatalCount,
    warningCount,
  };
}

function doctorExitCode(checks) {
  return summarizeChecks(checks).fatalCount ? 1 : 0;
}

function extensionConfirmationStatus({ pingOk }) {
  return pingOk ? 'success' : 'warning';
}

function aggregateRunStatus({ preflightStatus, recentStatus, exportStatus, organizeStatus }) {
  if (preflightStatus === 'failed' || recentStatus === 'failed' || exportStatus === 'failed' || organizeStatus === 'failed') return 'failed';
  if (exportStatus === 'partial' || organizeStatus === 'partial') return 'partial';
  if (recentStatus === 'success' && exportStatus === 'success' && organizeStatus === 'success') return 'success';
  return 'failed';
}

function determineFailureStage({ preflightStatus, recentStatus, exportStatus, organizeStatus }) {
  if (preflightStatus === 'failed') return 'preflight';
  if (recentStatus === 'failed') return 'export_recent';
  if (exportStatus === 'partial') return 'export_project';
  if (organizeStatus === 'failed' || organizeStatus === 'partial') return 'organize';
  return null;
}

function buildPingRequest(requestId) {
  return {
    source: 'CHATGPT_BACKUP_AUTOMATION',
    type: 'PING',
    requestId,
  };
}

async function pingExtension(page, timeoutMs = 3000) {
  const requestId = `phase6-ping-${Date.now()}`;
  return page.evaluate(({ request, timeout }) => new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'Timed out waiting for extension bridge ping' });
    }, timeout);
    function onMessage(event) {
      const data = event.data || {};
      if (
        event.source === window
        && data.source === 'CHATGPT_BACKUP_EXTENSION'
        && data.type === 'PING_RESULT'
        && data.requestId === request.requestId
      ) {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ ok: Boolean(data.ok), extension: data.extension || null, error: data.error || null });
      }
    }
    window.addEventListener('message', onMessage);
    window.postMessage(request, window.location.origin);
  }), { request: buildPingRequest(requestId), timeout: timeoutMs });
}

function createRunSummary({ runId, targetEmail, logPath }) {
  return {
    runId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'failed',
    configPath: CONFIG_PATH,
    targetEmail,
    failureStage: null,
    preflight: { status: 'pending', checks: [] },
    export: { status: 'pending', summaryPath: null, recent: {}, projects: [], totals: {} },
    organize: { status: 'pending', summaryPath: null, archiveAccountRoot: null, totals: {} },
    artifacts: { logPath, screenshots: [], stagingZips: [], indexPath: null },
    safety: { ...NO_DELETION_POLICY },
  };
}

function latestMatchingFile(directory, pattern) {
  if (!fs.existsSync(directory)) return null;
  const candidates = fs.readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

function addCheck(checks, name, status, detail, extra = {}) {
  checks.push({ name, status, detail, ...extra });
}

async function runPreflight({ requireCdp = false, requireChatGptPage = false, requirePing = false } = {}) {
  const checks = [];
  let config = null;
  let browser = null;
  let page = null;
  const requiredStatus = (required) => (required ? 'fatal' : 'warning');

  addCheck(checks, 'node', 'success', process.version);
  addCheck(checks, 'project_root', fs.existsSync(PROJECT_ROOT) ? 'success' : 'fatal', PROJECT_ROOT);
  addCheck(checks, 'package_dependencies', fs.existsSync(path.join(PROJECT_ROOT, 'node_modules')) ? 'success' : 'fatal', 'node_modules');
  try {
    require.resolve('playwright');
    addCheck(checks, 'playwright', 'success', 'require succeeded');
  } catch (error) {
    addCheck(checks, 'playwright', 'fatal', error.message);
  }

  try {
    config = loadConfig();
    addCheck(checks, 'config', 'success', CONFIG_PATH);
  } catch (error) {
    addCheck(checks, 'config', 'fatal', error.message);
  }

  for (const directory of LOCAL_DIRS) {
    try {
      ensureDir(directory);
      fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
      addCheck(checks, `local_${path.basename(directory)}`, 'success', directory);
    } catch (error) {
      addCheck(checks, `local_${path.basename(directory)}`, 'fatal', error.message);
    }
  }

  if (config) {
    for (const [name, directory] of [['archive_root', config.archive_root], ['staging_dir', config.staging_dir]]) {
      try {
        ensureDir(directory);
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
        addCheck(checks, name, 'success', directory);
      } catch (error) {
        addCheck(checks, name, 'fatal', error.message);
      }
    }
  }

  const launcherOk = fs.existsSync(START_SCRIPT) && Boolean(fs.statSync(START_SCRIPT).mode & 0o111);
  addCheck(checks, 'start_cdp_chrome', launcherOk ? 'success' : 'fatal', START_SCRIPT);

  if (config) {
    try {
      const { chromium } = require('playwright');
      browser = await chromium.connectOverCDP(config.cdp_url);
      addCheck(checks, 'cdp', 'success', config.cdp_url);
      const context = browser.contexts()[0];
      page = context?.pages().find((candidate) => candidate.url().startsWith('https://chatgpt.com/')) || null;
      addCheck(checks, 'chatgpt_page', page ? 'success' : requiredStatus(requireChatGptPage), page?.url() || 'No chatgpt.com page found');
      if (page) {
        const ping = await pingExtension(page);
        addCheck(checks, 'extension_bridge_ping', ping.ok ? 'success' : requiredStatus(requirePing), ping.ok ? ping.extension : ping.error);
      } else {
        addCheck(checks, 'extension_bridge_ping', requiredStatus(requirePing), 'No ChatGPT page available for ping');
      }
    } catch (error) {
      addCheck(checks, 'cdp', requiredStatus(requireCdp), `${error.message}. Run ${START_SCRIPT}`);
      addCheck(checks, 'chatgpt_page', requiredStatus(requireChatGptPage), 'CDP unavailable');
      addCheck(checks, 'extension_bridge_ping', requiredStatus(requirePing), 'CDP unavailable');
    }
  }

  const stagingZipCount = config && fs.existsSync(config.staging_dir)
    ? fs.readdirSync(config.staging_dir).filter((name) => name.endsWith('.zip')).length
    : 0;
  addCheck(checks, 'staging_zip_inventory', 'success', `${stagingZipCount} ZIP files`, { count: stagingZipCount });

  const accountRoot = config ? path.join(config.archive_root, config.target_email) : null;
  const indexPath = accountRoot ? path.join(accountRoot, '_index.json') : null;
  addCheck(checks, 'account_archive_root', 'success', accountRoot && fs.existsSync(accountRoot) ? 'exists' : 'not created');
  if (indexPath && fs.existsSync(indexPath)) {
    try {
      JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      addCheck(checks, 'archive_index', 'success', 'readable');
    } catch (error) {
      addCheck(checks, 'archive_index', 'fatal', error.message);
    }
  } else {
    addCheck(checks, 'archive_index', 'warning', 'not found');
  }
  const latestPhase5 = latestMatchingFile(path.join(PROJECT_ROOT, '.local', 'state'), /^phase5-organize-summary-.*\.json$/);
  addCheck(checks, 'latest_phase5_summary', latestPhase5 ? 'success' : 'warning', latestPhase5 || 'not found');
  const pingOk = checks.find((check) => check.name === 'extension_bridge_ping')?.status === 'success';
  addCheck(checks, 'extension_manual_confirmation', extensionConfirmationStatus({ pingOk }), pingOk
    ? 'Bridge ping confirms the extension content script; run:once still requires explicit user confirmation'
    : 'Confirm ChatGPT-Backup in chrome://extensions before run:once');

  return { config, checks, ...summarizeChecks(checks), browser, page, accountRoot, indexPath, stagingZipCount };
}

module.exports = {
  CONFIG_PATH,
  DEFAULTS,
  LOCAL_DIRS,
  NO_DELETION_POLICY,
  PROJECT_ROOT,
  START_SCRIPT,
  aggregateRunStatus,
  atomicWrite,
  buildPingRequest,
  createRunSummary,
  determineFailureStage,
  doctorExitCode,
  extensionConfirmationStatus,
  ensureDir,
  loadConfig,
  localTimestamp,
  pingExtension,
  runPreflight,
  summarizeChecks,
  validateConfig,
};
