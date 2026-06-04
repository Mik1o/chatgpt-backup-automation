const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const extensionPath = path.join(repoRoot, 'extension', 'chatgpt-backup');
const userDataDir = path.join(repoRoot, '.local', 'chrome-user-data');
const chromiumHomeDir = path.join(repoRoot, '.local', 'chromium-home');
const chromiumConfigDir = path.join(chromiumHomeDir, '.config');
const chromiumCacheDir = path.join(chromiumHomeDir, '.cache');
const logsDir = path.join(repoRoot, '.local', 'logs');
const screenshotsDir = path.join(repoRoot, '.local', 'screenshots');
const stateDir = path.join(repoRoot, '.local', 'state');
const tmpDir = path.join(repoRoot, '.local', 'tmp');
const unzipTestDir = path.join(tmpDir, 'phase3b-unzip-test');
const crashDumpsDir = path.join(tmpDir, 'phase3b-chromium-crash-dumps');
const stagingDir = '/Users/one/Downloads/ChatGPT_Backup_Staging';
const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(repoRoot, '.local', 'ms-playwright');
const runTimestamp = localTimestamp();
const requestId = `phase3b-smoke-${runTimestamp}`;
const backupRunId = `phase3b-smoke-${runTimestamp}`;
const logPath = path.join(logsDir, `phase3b-smoke-test-${runTimestamp}.log`);
const resultPath = path.join(stateDir, 'phase3b-smoke-result.json');
const maxWaitMs = 10 * 60 * 1000;

let context = null;
let page = null;
let logStream = null;
let chromium = null;

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(message, meta = undefined) {
  const line = `${new Date().toISOString()} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`;
  console.log(line);
  if (logStream) logStream.write(`${line}\n`);
}

function writeResult(result) {
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
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

function listZipFiles() {
  if (!fs.existsSync(stagingDir)) return [];
  return fs.readdirSync(stagingDir)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => {
      const fullPath = path.join(stagingDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
    });
}

function listCrdownloadsFor(zipName) {
  if (!fs.existsSync(stagingDir)) return [];
  const prefix = zipName ? zipName.replace(/\.zip$/, '') : '';
  return fs.readdirSync(stagingDir)
    .filter((name) => name.endsWith('.crdownload') && (!prefix || name.includes(prefix)))
    .map((name) => path.join(stagingDir, name));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStableFile(filePath) {
  let lastSize = -1;
  let stableSince = null;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (!fs.existsSync(filePath)) {
      await sleep(1000);
      continue;
    }

    const size = fs.statSync(filePath).size;
    if (size > 0 && size === lastSize) {
      stableSince = stableSince || Date.now();
      if (Date.now() - stableSince >= 3000) return { size };
    } else {
      stableSince = null;
      lastSize = size;
    }

    await sleep(1000);
  }

  throw new Error('Timed out waiting for ZIP size to stabilize');
}

function validateZipReadable(zipPath) {
  try {
    const output = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const markdownCount = output.split('\n').filter((line) => /\.mdx?\s*$/.test(line.trim())).length;
    return { unzipAvailable: true, markdownCount };
  } catch (error) {
    if (error.code === 'ENOENT') return { unzipAvailable: false, markdownCount: null, error: 'unzip missing' };
    return { unzipAvailable: true, markdownCount: 0, error: error.message || String(error) };
  }
}

function configureDownloadPrefs() {
  const defaultProfileDir = path.join(userDataDir, 'Default');
  ensureDir(defaultProfileDir);
  const preferencesPath = path.join(defaultProfileDir, 'Preferences');
  let preferences = {};

  if (fs.existsSync(preferencesPath)) {
    try {
      preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    } catch (_error) {
      preferences = {};
    }
  }

  preferences.download = {
    ...(preferences.download || {}),
    default_directory: stagingDir,
    directory_upgrade: true,
    prompt_for_download: false,
  };
  preferences.profile = {
    ...(preferences.profile || {}),
    default_content_setting_values: {
      ...(preferences.profile?.default_content_setting_values || {}),
      automatic_downloads: 1,
    },
  };

  fs.writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2));
}

function ensureLocalCrashpadDirs() {
  [
    path.join(chromiumHomeDir, 'Library', 'Application Support', 'Google', 'Chrome for Testing', 'Crashpad'),
    path.join(chromiumHomeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Crashpad'),
    path.join(chromiumHomeDir, 'Library', 'Application Support', 'Chromium', 'Crashpad'),
  ].forEach(ensureDir);
}

async function setDownloadBehavior(pageForCdp) {
  try {
    const cdpSession = await context.newCDPSession(pageForCdp);
    await cdpSession.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: stagingDir,
    });
    log('configured download behavior via CDP', { stagingDir });
  } catch (error) {
    log('download behavior CDP configuration failed; continuing with profile prefs', { error: error.message || String(error) });
  }
}

async function assertExtensionLoaded() {
  const existing = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
  if (existing) return existing.url();

  const worker = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  if (worker?.url().startsWith('chrome-extension://')) return worker.url();

  throw new Error('Bundled Chromium extension side-load failed');
}

async function triggerBridge() {
  page.setDefaultTimeout(maxWaitMs);
  return page.evaluate(({ requestId: evalRequestId, backupRunId: evalBackupRunId, timeoutMs }) => new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'Timed out waiting for extension bridge response', elapsedMs: Date.now() - startedAt });
    }, timeoutMs);

    function onMessage(event) {
      const data = event.data || {};
      if (
        event.source === window &&
        data.source === 'CHATGPT_BACKUP_EXTENSION' &&
        data.type === 'EXPORT_MARKDOWN_ZIP_RESULT' &&
        data.requestId === evalRequestId
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
      requestId: evalRequestId,
      payload: {
        bucket: 'recent',
        name: '最近对话',
        backupRunId: evalBackupRunId,
      },
    }, window.location.origin);
  }), { requestId, backupRunId, timeoutMs: maxWaitMs });
}

function findNewZip(beforeZipNames, responseFilename) {
  const before = new Set(beforeZipNames);
  const after = listZipFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (responseFilename) {
    const byResponse = after.find((file) => file.name === responseFilename);
    if (byResponse) return byResponse;
  }
  return after.find((file) => !before.has(file.name) && /^chatgpt-backup__recent__.+\.zip$/.test(file.name));
}

function rotateScreenshots() {
  if (!fs.existsSync(screenshotsDir)) return;
  const screenshots = fs.readdirSync(screenshotsDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => {
      const fullPath = path.join(screenshotsDir, name);
      return { path: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  while (screenshots.length > 50) {
    fs.unlinkSync(screenshots.shift().path);
  }
}

async function captureFailureScreenshot() {
  if (!page) return null;
  ensureDir(screenshotsDir);
  const screenshotPath = path.join(screenshotsDir, `phase3b-smoke-failure-${runTimestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  rotateScreenshots();
  return fs.existsSync(screenshotPath) ? screenshotPath : null;
}

async function holdBrowserForInspection() {
  if (!context) return;
  await promptEnter('Phase 3B failed. The automation browser is being kept open for inspection.');
}

async function main() {
  ensureDir(logsDir);
  ensureDir(screenshotsDir);
  ensureDir(stateDir);
  ensureDir(tmpDir);
  ensureDir(unzipTestDir);
  ensureDir(crashDumpsDir);
  ensureDir(userDataDir);
  ensureDir(chromiumHomeDir);
  ensureDir(chromiumConfigDir);
  ensureDir(chromiumCacheDir);
  ensureLocalCrashpadDirs();
  ensureDir(stagingDir);
  process.env.HOME = chromiumHomeDir;
  process.env.XDG_CONFIG_HOME = chromiumConfigDir;
  process.env.XDG_CACHE_HOME = chromiumCacheDir;
  ({ chromium } = require('playwright'));
  logStream = fs.createWriteStream(logPath, { flags: 'a' });

  configureDownloadPrefs();

  const args = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--disable-crashpad',
    `--crash-dumps-dir=${crashDumpsDir}`,
  ];

  log('phase3b smoke starting', {
    browserType: 'Playwright bundled Chromium',
    playwrightBrowsersPath,
    extensionPath,
    userDataDir,
    chromiumHomeDir,
    chromiumConfigDir,
    chromiumCacheDir,
    stagingDir,
    args,
    requestId,
  });

  const beforeZips = listZipFiles();
  log('staging before ZIPs', { count: beforeZips.length, names: beforeZips.map((file) => file.name) });

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    downloadsPath: stagingDir,
    args,
    env: {
      ...process.env,
      HOME: chromiumHomeDir,
      XDG_CONFIG_HOME: chromiumConfigDir,
      XDG_CACHE_HOME: chromiumCacheDir,
    },
  });

  page = context.pages()[0] || await context.newPage();
  await setDownloadBehavior(page);
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('opened ChatGPT page', { url: page.url() });

  const extensionWorkerUrl = await assertExtensionLoaded();
  log('extension service worker loaded', { extensionWorkerUrl });

  await promptEnter([
    'Please log in to the target ChatGPT account in the opened automation browser.',
    'Confirm:',
    '1. target ChatGPT account',
    '2. Personal space',
    '3. English UI',
    '4. current page is a recent chat, not a project chat',
    'Then return to terminal and press Enter to continue.',
  ].join('\n'));

  log('manual confirmation received', { url: page.url() });

  const bridgeResponse = await triggerBridge();
  log('bridge response', {
    ok: bridgeResponse?.ok,
    requestId: bridgeResponse?.requestId,
    result: bridgeResponse?.result,
    error: bridgeResponse?.error,
    elapsedMs: bridgeResponse?.elapsedMs,
  });
  if (!bridgeResponse?.ok) throw new Error(bridgeResponse?.error || 'Bridge export failed');

  const responseFilename = bridgeResponse.result?.filename;
  const newZip = findNewZip(beforeZips.map((file) => file.name), responseFilename);
  if (!newZip) throw new Error('No new automation ZIP found in staging directory');
  if (!/^chatgpt-backup__recent__.+\.zip$/.test(newZip.name)) throw new Error(`Unexpected ZIP filename: ${newZip.name}`);

  const crdownloads = listCrdownloadsFor(newZip.name);
  if (crdownloads.length) throw new Error(`Download still has crdownload file: ${crdownloads.join(', ')}`);

  const stable = await waitForStableFile(newZip.path);
  const zipCheck = validateZipReadable(newZip.path);
  if (zipCheck.unzipAvailable && zipCheck.markdownCount < 1) throw new Error('ZIP is readable but contains no markdown files');

  const result = {
    ok: true,
    timestamp: runTimestamp,
    browserType: 'Playwright bundled Chromium',
    playwrightBrowsersPath,
    logPath,
    requestId,
    extensionWorkerUrl,
    userDataDir,
    chromiumHomeDir,
    chromiumConfigDir,
    chromiumCacheDir,
    stagingDir,
    bridgeResponse,
    zip: {
      filename: newZip.name,
      path: newZip.path,
      size: stable.size,
      markdownCount: zipCheck.markdownCount,
      unzipAvailable: zipCheck.unzipAvailable,
    },
    browserClosed: true,
  };
  writeResult(result);
  log('phase3b smoke success', result);
  await context.close();
}

main().catch(async (error) => {
  const screenshotPath = await captureFailureScreenshot();
  const result = {
    ok: false,
    timestamp: runTimestamp,
    browserType: 'Playwright bundled Chromium',
    playwrightBrowsersPath,
    logPath,
    requestId,
    userDataDir,
    chromiumHomeDir,
    chromiumConfigDir,
    chromiumCacheDir,
    stagingDir,
    error: error.message || String(error),
    screenshotPath,
    browserClosed: false,
  };
  writeResult(result);
  log('phase3b smoke failed', result);
  await holdBrowserForInspection();
  process.exitCode = 1;
}).finally(() => {
  if (logStream) logStream.end();
});
