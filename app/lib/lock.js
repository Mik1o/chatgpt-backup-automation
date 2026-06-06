const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, ensureDir } = require('./phase6');

const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function inspectLock({ lockPath, now = new Date(), isPidAlive = defaultIsPidAlive }) {
  if (!fs.existsSync(lockPath)) return { status: 'free', lock: null, warnings: [] };
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const ageMs = now.getTime() - new Date(lock.started_at).getTime();
    const alive = Number.isInteger(lock.pid) && isPidAlive(lock.pid);
    if (!alive || !Number.isFinite(ageMs) || ageMs > STALE_AFTER_MS) {
      return { status: 'stale', lock, warnings: [`Removed stale project lock for run ${lock.run_id || 'unknown'}`] };
    }
    return { status: 'active', lock, warnings: [] };
  } catch (error) {
    return { status: 'stale', lock: null, warnings: [`Removed unreadable project lock: ${error.message}`] };
  }
}

function acquireLock({ lockPath, mode, runId, pid = process.pid, now = new Date(), isPidAlive = defaultIsPidAlive }) {
  ensureDir(path.dirname(lockPath));
  const inspected = inspectLock({ lockPath, now, isPidAlive });
  if (inspected.status === 'active') {
    return { acquired: false, status: 'skipped_locked', existing: inspected.lock, warnings: inspected.warnings };
  }
  if (inspected.status === 'stale') fs.unlinkSync(lockPath);
  const owner = { pid, started_at: now.toISOString(), mode, run_id: runId };
  atomicWrite(lockPath, `${JSON.stringify(owner, null, 2)}\n`);
  return { acquired: true, status: 'acquired', owner, warnings: inspected.warnings };
}

function releaseLock({ lockPath, owner }) {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (current.run_id !== owner?.run_id || current.pid !== owner?.pid) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { STALE_AFTER_MS, acquireLock, inspectLock, releaseLock };
