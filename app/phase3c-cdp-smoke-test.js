const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const cdpUrl = 'http://127.0.0.1:9222';
const extensionPath = path.join(repoRoot, 'extension', 'chatgpt-backup');
const userDataDirCdp = path.join(repoRoot, '.local', 'chrome-user-data-cdp');
const startScriptPath = path.join(repoRoot, 'scripts', 'start-cdp-chrome.sh');
const logsDir = path.join(repoRoot, '.local', 'logs');
const screenshotsDir = path.join(repoRoot, '.local', 'screenshots');
const stateDir = path.join(repoRoot, '.local', 'state');
const tmpDir = path.join(repoRoot, '.local', 'tmp');
const unzipTestDir = path.join(tmpDir, 'phase3c-unzip-test');
const stagingDir = '/Users/one/Downloads/ChatGPT_Backup_Staging';
const runTimestamp = localTimestamp();
const requestId = `phase3c-smoke-${runTimestamp}`;
const backupRunId = `phase3c-smoke-${runTimestamp}`;
const logPath = path.join(logsDir, `phase3c-cdp-smoke-test-${runTimestamp}.log`);
const resultPath = path.join(stateDir, 'phase3c-cdp-smoke-result.json');
const maxWaitMs = 10 * 60 * 1000;

let browser = null;
let selectedPage = null;
let logStream = null;

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

function getAllPages() {
  return browser.contexts().flatMap((context) => context.pages());
}

function findChatGptPage() {
  return getAllPages().find((page) => page.url().startsWith('https://chatgpt.com/'));
}

async function waitForChatGptPage() {
  let page = findChatGptPage();
  if (page) return page;

  log('no ChatGPT page found', { pages: getAllPages().map((candidate) => candidate.url()) });
  await promptEnter([
    'No https://chatgpt.com/ page was found in the automation Chrome.',
    'Open https://chatgpt.com/ in that Chrome, complete login/verification, enter a recent chat, then return here.',
  ].join('\n'));

  page = findChatGptPage();
  if (!page) throw new Error('No https://chatgpt.com/ page found after user confirmation');
  return page;
}

async function setDownloadBehavior(page) {
  try {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: stagingDir,
    });
    log('configured download behavior via Browser.setDownloadBehavior', { stagingDir });
    return true;
  } catch (browserError) {
    try {
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: stagingDir,
      });
      log('configured download behavior via Page.setDownloadBehavior', { stagingDir });
      return true;
    } catch (pageError) {
      log('download behavior configuration failed; continuing', {
        browserError: browserError.message || String(browserError),
        pageError: pageError.message || String(pageError),
      });
      return false;
    }
  }
}

async function inferExtensionLoaded() {
  const pages = getAllPages();
  const extensionPage = pages.find((page) => page.url().startsWith('chrome-extension://'));
  if (extensionPage) return { inferred: true, source: 'extension page', url: extensionPage.url() };

  return { inferred: null, source: 'not directly observable over existing pages' };
}

async function triggerBridge(page) {
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

  while (screenshots.length > 50) fs.unlinkSync(screenshots.shift().path);
}

async function captureFailureScreenshot() {
  if (!selectedPage) return null;
  ensureDir(screenshotsDir);
  const screenshotPath = path.join(screenshotsDir, `phase3c-cdp-smoke-failure-${runTimestamp}.png`);
  await selectedPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  rotateScreenshots();
  return fs.existsSync(screenshotPath) ? screenshotPath : null;
}

async function main() {
  ensureDir(logsDir);
  ensureDir(screenshotsDir);
  ensureDir(stateDir);
  ensureDir(tmpDir);
  ensureDir(unzipTestDir);
  ensureDir(stagingDir);
  logStream = fs.createWriteStream(logPath, { flags: 'a' });

  log('phase3c cdp smoke starting', {
    cdpUrl,
    extensionPath,
    userDataDirCdp,
    stagingDir,
    requestId,
  });

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error([
      `Unable to connect to ${cdpUrl}: ${error.message || error}`,
      `Start automation Chrome first: ${startScriptPath}`,
    ].join('\n'));
  }

  const pageUrls = getAllPages().map((page) => page.url());
  log('connected over CDP', { contextCount: browser.contexts().length, pageUrls });

  selectedPage = await waitForChatGptPage();
  log('selected ChatGPT page', { url: selectedPage.url() });

  const downloadBehaviorConfigured = await setDownloadBehavior(selectedPage);
  const extensionLoaded = await inferExtensionLoaded();

  await promptEnter([
    'Confirm in the automation Chrome:',
    '1. target ChatGPT account is logged in',
    '2. current space is Personal',
    '3. UI is English',
    '4. current page is a recent chat, not a project chat',
    'Do not continue from a Cloudflare, login, or project page.',
  ].join('\n'));

  log('manual confirmation received', { url: selectedPage.url(), extensionLoaded, downloadBehaviorConfigured });

  const beforeZips = listZipFiles();
  log('staging before ZIPs', { count: beforeZips.length, names: beforeZips.map((file) => file.name) });

  const bridgeResponse = await triggerBridge(selectedPage);
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
    logPath,
    cdpUrl,
    requestId,
    extensionPath,
    userDataDirCdp,
    stagingDir,
    selectedPageUrl: selectedPage.url(),
    extensionLoaded,
    downloadBehaviorConfigured,
    bridgeResponse,
    zip: {
      filename: newZip.name,
      path: newZip.path,
      size: stable.size,
      markdownCount: zipCheck.markdownCount,
      unzipAvailable: zipCheck.unzipAvailable,
    },
    browserClosed: false,
    browserKeptOpen: true,
  };
  writeResult(result);
  log('phase3c cdp smoke success', result);
}

main().catch(async (error) => {
  const screenshotPath = await captureFailureScreenshot();
  const result = {
    ok: false,
    timestamp: runTimestamp,
    logPath,
    cdpUrl,
    requestId,
    extensionPath,
    userDataDirCdp,
    stagingDir,
    selectedPageUrl: selectedPage?.url() || null,
    discoveredPageUrls: browser ? getAllPages().map((page) => page.url()) : [],
    error: error.message || String(error),
    screenshotPath,
    browserClosed: false,
    browserKeptOpen: Boolean(browser),
  };
  writeResult(result);
  log('phase3c cdp smoke failed', result);
  process.exitCode = 1;
}).finally(() => {
  if (logStream) logStream.end();
});
