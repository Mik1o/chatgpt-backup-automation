const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { loadConfig, PROJECT_ROOT } = require('./lib/phase6');
const { latestMatchingFile } = require('./lib/phase7-util');

const LABEL = 'com.local.chatgpt-backup-automation';
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'launchd', `${LABEL}.plist.template`);
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const DOMAIN = `gui/${process.getuid()}`;

function renderPlist() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

function confirmExact(expected) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Type ${expected} to continue: `, (answer) => {
      rl.close();
      resolve(answer === expected);
    });
  });
}

function commandOutput(command, args) {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: 'utf8' }).trim() };
  } catch (error) {
    return { ok: false, output: error.stdout?.toString().trim() || error.stderr?.toString().trim() || error.message };
  }
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

async function install() {
  loadConfig();
  if (!await confirmExact('INSTALL')) return console.log('Install cancelled; no plist written.');
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, renderPlist(), { mode: 0o644 });
  fs.chmodSync(PLIST_PATH, 0o644);
  if (fs.statSync(PLIST_PATH).mode & 0o022) throw new Error('Refusing group/world-writable LaunchAgent plist');
  execFileSync('/usr/bin/plutil', ['-lint', PLIST_PATH], { stdio: 'inherit' });
  execFileSync('/bin/launchctl', ['bootstrap', DOMAIN, PLIST_PATH], { stdio: 'inherit' });
  return status();
}

async function uninstall() {
  if (!await confirmExact('UNINSTALL')) return console.log('Uninstall cancelled.');
  commandOutput('/bin/launchctl', ['bootout', `${DOMAIN}/${LABEL}`]);
  if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
  console.log('LaunchAgent unloaded and project plist removed. Runtime state and logs were preserved.');
}

async function kickstart() {
  if (!await confirmExact('KICKSTART')) return console.log('Kickstart cancelled.');
  execFileSync('/bin/launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`], { stdio: 'inherit' });
}

function status() {
  const stateDir = path.join(PROJECT_ROOT, '.local', 'state');
  const schedulerStatePath = path.join(stateDir, 'scheduler-state.json');
  const latestScheduledSummary = latestMatchingFile(stateDir, /^run-scheduled-summary-.*\.json$/);
  const printed = commandOutput('/bin/launchctl', ['print', `${DOMAIN}/${LABEL}`]);
  console.log(JSON.stringify({
    label: LABEL,
    plistPath: PLIST_PATH,
    plistExists: fs.existsSync(PLIST_PATH),
    loaded: printed.ok,
    launchctl: printed.output,
    schedulerStatePath,
    schedulerState: readJsonIfPresent(schedulerStatePath),
    latestScheduledSummary,
    latestScheduledStatus: latestScheduledSummary ? readJsonIfPresent(latestScheduledSummary)?.status || null : null,
    stdoutLog: path.join(PROJECT_ROOT, '.local', 'logs', 'launchagent.out.log'),
    stderrLog: path.join(PROJECT_ROOT, '.local', 'logs', 'launchagent.err.log'),
  }, null, 2));
}

async function main(command = process.argv[2]) {
  if (command === 'print-plist') return process.stdout.write(renderPlist());
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall();
  if (command === 'status') return status();
  if (command === 'kickstart') return kickstart();
  throw new Error('Usage: launchagent.js install|uninstall|status|kickstart|print-plist');
}

module.exports = { LABEL, PLIST_PATH, main, renderPlist };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
