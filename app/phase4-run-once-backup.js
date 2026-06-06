const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const PROJECT_ROOT = '/Users/one/chatgpt-backup-automation';
const CDP_URL = 'http://127.0.0.1:9222';
const STAGING_DIR = '/Users/one/Downloads/ChatGPT_Backup_Staging';
const LOG_DIR = path.join(PROJECT_ROOT, '.local', 'logs');
const STATE_DIR = path.join(PROJECT_ROOT, '.local', 'state');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, '.local', 'screenshots');
const START_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'start-cdp-chrome.sh');
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
const runId = `phase4-run-${localTimestamp()}`;
const logPath = path.join(LOG_DIR, `phase4-run-once-backup-${runId}.log`);
const summaryPath = path.join(STATE_DIR, `phase4-run-summary-${runId}.json`);

let browser = null;
let context = null;
let page = null;
let logStream = null;
let screenshotSequence = 0;

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(name = 'untitled') {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function validateBucket(bucket) {
  if (bucket !== 'recent' && bucket !== 'project') {
    throw new Error(`Invalid bucket: ${bucket}`);
  }
  return bucket;
}

function buildExpectedZipFilename(bucket, name, backupRunId) {
  const normalizedBucket = validateBucket(bucket);
  const safeName = sanitizeFilename(name || (normalizedBucket === 'recent' ? 'recent' : 'project')).slice(0, 80);
  const safeRunId = sanitizeFilename(backupRunId).slice(0, 60);
  return `chatgpt-backup__${normalizedBucket}__${safeName}__${safeRunId}.zip`;
}

function isAcceptedZipFilename(actual, expected) {
  return actual !== 'download.zip'
    && actual === expected
    && actual.startsWith('chatgpt-backup__')
    && actual.endsWith('.zip');
}

function aggregateStatus({ recentStatus, projectStatuses }) {
  if (recentStatus !== 'success') return 'failed';
  if (projectStatuses.some((status) => status === 'failed')) return 'partial';
  return 'success';
}

function log(message, meta = undefined) {
  const line = `${new Date().toISOString()} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`;
  console.log(line);
  if (logStream) logStream.write(`${line}\n`);
}

function promptEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\nPress Enter to continue...`, () => {
      rl.close();
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listZipNames() {
  if (!fs.existsSync(STAGING_DIR)) return [];
  return fs.readdirSync(STAGING_DIR).filter((name) => name.endsWith('.zip')).sort();
}

function validateZip(zipPath) {
  const output = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const mdCount = output.split('\n').filter((line) => /\.mdx?\s*$/.test(line.trim())).length;
  if (mdCount < 1) throw new Error('ZIP is readable but contains no markdown files');
  return { mdCount };
}

async function waitForExpectedZip({ beforeZipNames, bucket, nameForFilename, backupRunId, timeoutMs = EXPORT_TIMEOUT_MS }) {
  const expected = buildExpectedZipFilename(bucket, nameForFilename, backupRunId);
  const before = new Set(beforeZipNames);
  const deadline = Date.now() + timeoutMs;
  let stableSize = -1;
  let stableSince = null;

  while (Date.now() < deadline) {
    const current = listZipNames();
    const newNames = current.filter((name) => !before.has(name));
    const exact = newNames.find((name) => isAcceptedZipFilename(name, expected));
    if (!exact) {
      await sleep(1000);
      continue;
    }

    const zipPath = path.join(STAGING_DIR, exact);
    const crdownloadPath = `${zipPath}.crdownload`;
    if (fs.existsSync(crdownloadPath)) {
      await sleep(1000);
      continue;
    }

    const size = fs.statSync(zipPath).size;
    if (size > 0 && size === stableSize) {
      stableSince = stableSince || Date.now();
      if (Date.now() - stableSince >= 3000) {
        const { mdCount } = validateZip(zipPath);
        return { zipPath, filename: exact, size, mdCount };
      }
    } else {
      stableSize = size;
      stableSince = null;
    }
    await sleep(1000);
  }

  const newZipNames = listZipNames().filter((name) => !before.has(name));
  throw new Error(`Expected ZIP not found or invalid: ${expected}; new ZIPs: ${newZipNames.join(', ') || 'none'}`);
}

async function exportMarkdownZip(targetPage, { bucket, name, backupRunId, timeoutMs = EXPORT_TIMEOUT_MS }) {
  validateBucket(bucket);
  const requestId = `${backupRunId}-${bucket}-${Date.now()}`;
  return targetPage.evaluate(({ requestId: id, payload, timeout }) => new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, requestId: id, error: 'Timed out waiting for extension bridge response', elapsedMs: Date.now() - startedAt });
    }, timeout);

    function onMessage(event) {
      const data = event.data || {};
      if (
        event.source === window
        && data.source === 'CHATGPT_BACKUP_EXTENSION'
        && data.type === 'EXPORT_MARKDOWN_ZIP_RESULT'
        && data.requestId === id
      ) {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ ...data, elapsedMs: Date.now() - startedAt });
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({
      source: 'CHATGPT_BACKUP_AUTOMATION',
      type: 'EXPORT_MARKDOWN_ZIP',
      requestId: id,
      payload,
    }, window.location.origin);
  }), {
    requestId,
    payload: { bucket, name, backupRunId },
    timeout: timeoutMs,
  });
}

async function resetDownloadBehavior(targetPage) {
  const session = await targetPage.context().newCDPSession(targetPage);
  await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
}

async function healthCheck(targetPage) {
  return targetPage.evaluate(() => {
    const url = window.location.href;
    const title = document.title || '';
    const isChatGpt = window.location.hostname === 'chatgpt.com' || window.location.hostname === 'www.chatgpt.com';
    const cloudflare = /checking your browser|just a moment/i.test(title)
      || Boolean(document.querySelector('#challenge-running, .cf-challenge, [data-testid="cf-turnstile"]'));
    const login = /\/auth\/login|\/login/.test(window.location.pathname)
      || Boolean(document.querySelector('form[action*="login"], input[type="password"]'));
    const hasApp = Boolean(document.querySelector('main, nav, aside, textarea, [contenteditable="true"]'));
    return { url, isChatGpt, cloudflare, login, hasApp };
  });
}

async function discoverProjects(targetPage) {
  return targetPage.evaluate(() => {
    const names = Array.from(document.querySelectorAll('button[aria-label^="Open project options for "]'))
      .map((button) => button.getAttribute('aria-label').replace('Open project options for ', '').trim())
      .filter(Boolean);
    return Array.from(new Set(names)).map((name) => ({ name, href: null }));
  });
}

async function openFirstProjectConversation(targetPage, projectName) {
  const expanded = await targetPage.evaluate((name) => {
    const options = Array.from(document.querySelectorAll('button[aria-label^="Open project options for "]'))
      .find((button) => button.getAttribute('aria-label') === `Open project options for ${name}`);
    const row = options?.closest('li');
    const sidebarItem = row?.querySelector('[data-sidebar-item="true"]');
    if (!sidebarItem) return false;
    if (sidebarItem.getAttribute('aria-expanded') !== 'true') sidebarItem.click();
    return true;
  }, projectName);
  if (!expanded) throw new Error(`Could not find project sidebar row for ${projectName}`);
  await targetPage.waitForTimeout(1500);

  const href = await targetPage.evaluate((name) => {
    const options = Array.from(document.querySelectorAll('button[aria-label^="Open project options for "]'))
      .find((button) => button.getAttribute('aria-label') === `Open project options for ${name}`);
    const row = options?.closest('li');
    const anchor = Array.from(row?.querySelectorAll('a[href]') || []).find((candidate) => {
      const value = candidate.getAttribute('href') || '';
      const rect = candidate.getBoundingClientRect();
      return /\/g\/[^/]+\/c\/[^/?#]+/.test(value) && rect.width > 0 && rect.height > 0;
    });
    return anchor?.getAttribute('href') || null;
  }, projectName);
  if (!href) return { opened: false, href: null };
  await targetPage.goto(new URL(href, targetPage.url()).href, { waitUntil: 'domcontentloaded' });
  await targetPage.waitForTimeout(2000);
  return { opened: /\/g\/[^/]+\/c\/[^/?#]+/.test(targetPage.url()), href: targetPage.url() };
}

function rotateScreenshots() {
  const files = fs.readdirSync(SCREENSHOT_DIR)
    .filter((name) => name.endsWith('.png'))
    .map((name) => ({ path: path.join(SCREENSHOT_DIR, name), mtimeMs: fs.statSync(path.join(SCREENSHOT_DIR, name)).mtimeMs }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (files.length > 50) fs.unlinkSync(files.shift().path);
}

async function captureFailure(label) {
  if (!page) return null;
  const safeLabel = sanitizeFilename(label).replace(/\s+/g, '-').slice(0, 40);
  const screenshotPath = path.join(SCREENSHOT_DIR, `phase4-${runId}-${String(++screenshotSequence).padStart(2, '0')}-${safeLabel}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  rotateScreenshots();
  return fs.existsSync(screenshotPath) ? screenshotPath : null;
}

async function exportAndValidate({ bucket, name, nameForFilename }) {
  const beforeZipNames = listZipNames();
  const bridge = await exportMarkdownZip(page, { bucket, name, backupRunId: runId });
  log('bridge response', { bucket, name, ok: bridge?.ok, error: bridge?.error, elapsedMs: bridge?.elapsedMs, result: bridge?.result });
  if (!bridge?.ok) throw new Error(bridge?.error || `${bucket} bridge export failed`);
  const zip = await waitForExpectedZip({ beforeZipNames, bucket, nameForFilename, backupRunId: runId });
  return { bridge, ...zip };
}

function createSummary(startedAt) {
  return {
    runId,
    startedAt,
    endedAt: null,
    status: 'failed',
    recent: { status: 'pending', zipPath: null, mdCount: 0, error: null },
    projects: [],
    totals: {
      projectsFound: 0,
      projectsSucceeded: 0,
      projectsFailed: 0,
      projectsSkipped: 0,
      zipCount: 0,
      mdCount: 0,
    },
  };
}

function finalizeSummary(summary) {
  summary.endedAt = new Date().toISOString();
  summary.status = aggregateStatus({
    recentStatus: summary.recent.status,
    projectStatuses: summary.projects.map((project) => project.status),
  });
  summary.totals.projectsFound = summary.projects.length;
  summary.totals.projectsSucceeded = summary.projects.filter((project) => project.status === 'success').length;
  summary.totals.projectsFailed = summary.projects.filter((project) => project.status === 'failed').length;
  summary.totals.projectsSkipped = summary.projects.filter((project) => project.status === 'skipped_empty').length;
  summary.totals.zipCount = (summary.recent.status === 'success' ? 1 : 0) + summary.totals.projectsSucceeded;
  summary.totals.mdCount = (summary.recent.mdCount || 0)
    + summary.projects.reduce((total, project) => total + (project.mdCount || 0), 0);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

async function run() {
  ensureDir(LOG_DIR);
  ensureDir(STATE_DIR);
  ensureDir(SCREENSHOT_DIR);
  ensureDir(STAGING_DIR);
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const summary = createSummary(new Date().toISOString());

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    context = browser.contexts()[0];
    if (!context) throw new Error('CDP connected but no browser context was available');
    page = context.pages().find((candidate) => candidate.url().startsWith('https://chatgpt.com/'));
    if (!page) {
      await promptEnter('No ChatGPT page found. Open https://chatgpt.com/ in automation Chrome, then return here.');
      page = context.pages().find((candidate) => candidate.url().startsWith('https://chatgpt.com/'));
    }
    if (!page) throw new Error('No https://chatgpt.com/ page found after user confirmation');

    log('connected over CDP', { pageUrl: page.url(), pageCount: context.pages().length });
    await resetDownloadBehavior(page);
    await promptEnter([
      'Confirm in the automation Chrome window:',
      '1. target ChatGPT account',
      '2. Personal space',
      '3. English UI',
      '4. recent chats and projects are visible',
      '5. ChatGPT-Backup extension is loaded in chrome://extensions',
      'Press Ctrl+C to abort if any condition is not satisfied.',
    ].join('\n'));

    const health = await healthCheck(page);
    log('page health check', health);
    if (!health.isChatGpt || health.cloudflare || health.login || !health.hasApp) {
      await captureFailure('page-health-check');
      throw new Error(`ChatGPT page health check failed: ${JSON.stringify(health)}`);
    }
    if (/\/g\//.test(page.url())) {
      await promptEnter('Current page appears to be a project. Open a recent normal chat in automation Chrome, then return here.');
      if (/\/g\//.test(page.url())) throw new Error('Current page is still a project chat; recent export was not started');
    }

    try {
      const recent = await exportAndValidate({ bucket: 'recent', name: 'recent', nameForFilename: 'recent' });
      summary.recent = { status: 'success', zipPath: recent.zipPath, mdCount: recent.mdCount, error: null };
      log('recent export success', { zipPath: recent.zipPath, mdCount: recent.mdCount });
    } catch (error) {
      summary.recent = { status: 'failed', zipPath: null, mdCount: 0, error: error.message || String(error) };
      await captureFailure('recent-export');
      throw error;
    }

    const projects = await discoverProjects(page);
    log('projects discovered', { count: projects.length, names: projects.map((project) => project.name) });
    for (const discovered of projects) {
      const result = { name: discovered.name, href: discovered.href, status: 'failed', zipPath: null, mdCount: 0, attempts: 0, error: null };
      summary.projects.push(result);

      try {
        const conversation = await openFirstProjectConversation(page, discovered.name);
        if (!conversation.opened) {
          result.status = 'skipped_empty';
          result.error = 'No visible project conversation found';
          log('project skipped empty', { name: result.name, href: result.href });
          continue;
        }
        result.href = conversation.href;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          result.attempts = attempt;
          try {
            const exported = await exportAndValidate({
              bucket: 'project',
              name: result.name,
              nameForFilename: result.name,
            });
            result.status = 'success';
            result.zipPath = exported.zipPath;
            result.mdCount = exported.mdCount;
            result.error = null;
            log('project export success', { name: result.name, href: result.href, attempts: attempt, zipPath: result.zipPath, mdCount: result.mdCount });
            break;
          } catch (error) {
            result.error = error.message || String(error);
            log('project export attempt failed', { name: result.name, attempts: attempt, error: result.error });
            if (attempt === 1) await sleep(2000);
          }
        }
        if (result.status !== 'success') await captureFailure(`project-${result.name}`);
      } catch (error) {
        result.status = 'failed';
        result.error = error.message || String(error);
        await captureFailure(`project-${result.name}`);
        log('project workflow failed', { name: result.name, error: result.error });
      }
    }
  } catch (error) {
    log('phase4 workflow failed', { error: error.message || String(error), startScript: START_SCRIPT });
    if (summary.recent.status === 'pending') summary.recent = { status: 'failed', zipPath: null, mdCount: 0, error: error.message || String(error) };
    process.exitCode = 1;
  } finally {
    finalizeSummary(summary);
    log('phase4 workflow complete', { status: summary.status, totals: summary.totals, summaryPath, browserKeptOpen: Boolean(browser) });
    if (summary.status === 'partial') process.exitCode = 2;
    if (summary.status === 'failed') process.exitCode = 1;
  }
}

module.exports = {
  aggregateStatus,
  buildExpectedZipFilename,
  isAcceptedZipFilename,
  sanitizeFilename,
  validateBucket,
};

if (require.main === module) {
  run().finally(() => {
    const exitCode = process.exitCode || 0;
    if (logStream) {
      logStream.end(() => process.exit(exitCode));
    } else {
      process.exit(exitCode);
    }
  });
}
