const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, ensureDir } = require('./phase6');

const DEFAULT_SCHEDULE = Object.freeze({
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
});

function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeSchedule(schedule = {}) {
  return { ...DEFAULT_SCHEDULE, ...schedule };
}

function loadSchedulerState(statePath) {
  if (!fs.existsSync(statePath)) return { schema_version: 1, attempts_by_date: {} };
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return { schema_version: 1, ...state, attempts_by_date: state.attempts_by_date || {} };
}

function evaluateScheduleGate({ now = new Date(), schedule: inputSchedule = {}, state = {}, force = false }) {
  const schedule = normalizeSchedule(inputSchedule);
  const date = localDate(now);
  if (!schedule.enabled && !force) return { status: 'skipped_disabled', date, reason: 'Schedule is disabled' };
  if (force) return { status: 'run', date, reason: 'Force bypassed daily schedule gates' };
  const minutes = now.getHours() * 60 + now.getMinutes();
  const target = schedule.target_hour * 60 + schedule.target_minute;
  if (minutes < target) return { status: 'skipped_before_schedule', date, reason: 'Current local time is before target time' };
  if (state.last_success_date === date) return { status: 'skipped_success_today', date, reason: 'A scheduled backup already succeeded today' };
  const attempts = state.attempts_by_date?.[date] || 0;
  if (attempts >= schedule.max_scheduled_attempts_per_day) {
    return { status: 'skipped_attempt_limit', date, reason: 'Scheduled attempt limit reached for today' };
  }
  return { status: 'run', date, reason: 'Schedule gate allows a run' };
}

function updateSchedulerState(state = {}, { date, runId, status, countAttempt = false }) {
  const updated = {
    schema_version: 1,
    last_success_date: state.last_success_date || null,
    last_success_run_id: state.last_success_run_id || null,
    last_attempt_date: state.last_attempt_date || null,
    attempts_by_date: { ...(state.attempts_by_date || {}) },
    last_status: status,
    last_run_id: runId,
    updated_at: new Date().toISOString(),
  };
  if (countAttempt) {
    updated.last_attempt_date = date;
    updated.attempts_by_date[date] = (updated.attempts_by_date[date] || 0) + 1;
  }
  if (status === 'success') {
    updated.last_success_date = date;
    updated.last_success_run_id = runId;
  }
  return updated;
}

function writeSchedulerState(statePath, state) {
  ensureDir(path.dirname(statePath));
  atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

module.exports = {
  DEFAULT_SCHEDULE,
  evaluateScheduleGate,
  loadSchedulerState,
  localDate,
  normalizeSchedule,
  updateSchedulerState,
  writeSchedulerState,
};
