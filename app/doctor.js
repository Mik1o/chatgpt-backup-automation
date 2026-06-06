const path = require('node:path');
const {
  PROJECT_ROOT,
  atomicWrite,
  doctorExitCode,
  localTimestamp,
  runPreflight,
} = require('./lib/phase6');

async function run() {
  const startedAt = new Date().toISOString();
  const summaryPath = path.join(PROJECT_ROOT, '.local', 'state', `doctor-summary-${localTimestamp()}.json`);
  const preflight = await runPreflight();
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    status: preflight.status,
    checks: preflight.checks,
  };
  atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log('ChatGPT Backup Automation Doctor');
  for (const check of preflight.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`);
  }
  console.log(`Doctor status: ${summary.status}`);
  console.log(`Summary: ${summaryPath}`);
  process.exitCode = doctorExitCode(preflight.checks);
  return { summary, summaryPath };
}

module.exports = { run };

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
