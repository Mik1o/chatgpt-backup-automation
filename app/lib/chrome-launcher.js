const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { atomicWrite, ensureDir } = require('./phase6');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function isRecentChatUrl(value) {
  try {
    const url = new URL(value);
    return ['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname)
      && /^\/c\/[^/?#]+/.test(url.pathname)
      && !url.pathname.includes('/g/');
  } catch (_error) {
    return false;
  }
}

function cdpReachable(cdpUrl, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(new URL('/json/version', cdpUrl), { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForCdp(cdpUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpReachable(cdpUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensureAutomationChrome(config, { allowStart = true, initialUrl = 'https://chatgpt.com/' } = {}) {
  if (await cdpReachable(config.cdp_url)) return { reachable: true, started: false };
  if (!allowStart || !config.schedule.allow_auto_start_chrome) return { reachable: false, started: false, error: 'CDP unavailable and automatic Chrome start is disabled' };
  if (!fs.existsSync(CHROME_PATH)) return { reachable: false, started: false, error: `Google Chrome not found: ${CHROME_PATH}` };
  ensureDir(config.chrome_user_data_dir);
  const port = new URL(config.cdp_url).port;
  const child = spawn(CHROME_PATH, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${config.chrome_user_data_dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    initialUrl,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  const reachable = await waitForCdp(config.cdp_url);
  return { reachable, started: true, pid: child.pid, error: reachable ? null : 'Automation Chrome did not expose CDP within 60 seconds' };
}

function loadLastKnownRecent(statePath) {
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return isRecentChatUrl(state.recent_url) ? state : null;
}

function writeLastKnownRecent(statePath, { recentUrl, sourceRunId }) {
  if (!isRecentChatUrl(recentUrl)) throw new Error('Refusing non-recent ChatGPT URL');
  atomicWrite(statePath, `${JSON.stringify({ recent_url: recentUrl, updated_at: new Date().toISOString(), source_run_id: sourceRunId }, null, 2)}\n`);
}

async function ensureRecentPage(config, { statePath }) {
  const browser = await chromium.connectOverCDP(config.cdp_url);
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP connected but no browser context was available');
  const chatGptPages = context.pages().filter((page) => page.url().startsWith('https://chatgpt.com/'));
  let page = chatGptPages.find((candidate) => isRecentChatUrl(candidate.url())) || null;
  if (!page) {
    const known = loadLastKnownRecent(statePath);
    if (!known) throw new Error('No recent ChatGPT page or last-known recent URL; run run:once manually first');
    page = chatGptPages[0] || await context.newPage();
    await page.goto(known.recent_url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }
  if (!isRecentChatUrl(page.url())) throw new Error('Unable to prepare a recent non-project ChatGPT page');
  return { browser, page, recentUrl: page.url() };
}

module.exports = {
  CHROME_PATH,
  cdpReachable,
  ensureAutomationChrome,
  ensureRecentPage,
  isRecentChatUrl,
  loadLastKnownRecent,
  waitForCdp,
  writeLastKnownRecent,
};
