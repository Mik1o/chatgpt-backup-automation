# Phase 7 LaunchAgent Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a noninteractive scheduled backup runner with daily gates, shared locking, notifications, automation-Chrome startup support, and user-confirmed LaunchAgent management.

**Architecture:** Keep Phase 4/5 export and organizer logic unchanged. Add small pure modules for scheduler state, locking, notifications, and Chrome/recent-page readiness; `run-scheduled.js` composes them with Phase 4/5. LaunchAgent management only renders or installs a fixed project-local plist and requires exact interactive confirmation for mutating commands.

**Tech Stack:** Node.js CommonJS, Playwright CDP, macOS launchctl/plutil/osascript, launchd plist.

---

### Task 1: Pure Scheduler And Lock Contracts

**Files:**
- Create: `tests/phase7-static.test.js`
- Create: `app/lib/scheduler-state.js`
- Create: `app/lib/lock.js`

- [ ] Write failing tests for before-schedule, success-today, attempt-limit, force, state updates, active lock, and stale lock.
- [ ] Run the test and confirm missing-module failure.
- [ ] Implement pure gate/state functions and project-scoped lock handling.
- [ ] Run the test and confirm these contracts pass.

### Task 2: Notification, Recent URL, And Chrome Readiness

**Files:**
- Create: `app/lib/notify.js`
- Create: `app/lib/chrome-launcher.js`
- Modify: `app/lib/phase6.js`
- Test: `tests/phase7-static.test.js`

- [ ] Add failing tests for notification shape, schedule config defaults, and project-URL rejection.
- [ ] Implement osascript notification failure isolation, recent URL state, CDP reachability, and isolated Chrome startup.
- [ ] Run Phase 6 and Phase 7 static tests.

### Task 3: Noninteractive Scheduled Runner And Shared Manual Lock

**Files:**
- Create: `app/run-scheduled.js`
- Modify: `app/run-once.js`
- Modify: `package.json`
- Test: `tests/phase7-static.test.js`

- [ ] Add failing assertions for CLI flags, dry-run summary, no prompt, and shared lock use.
- [ ] Implement schedule gate, lock, Chrome/page readiness, Phase 4/5 calls, scheduler-state updates, last-known recent URL, notifications, and summaries.
- [ ] Add the same project lock to manual `run:once` while preserving its confirmation prompt.
- [ ] Run Phase 4/5/6/7 static tests.

### Task 4: LaunchAgent Artifacts And Manager

**Files:**
- Create: `launchd/com.local.chatgpt-backup-automation.plist.template`
- Create: `scripts/run-scheduled.sh`
- Create: `app/launchagent.js`
- Modify: `package.json`
- Test: `tests/phase7-static.test.js`

- [ ] Add failing assertions for label, interval, project path, scripts, and management commands.
- [ ] Implement plist rendering, print-plist, status, and exact-confirmation install/uninstall/kickstart commands.
- [ ] Verify rendered plist using `plutil -lint` without installing.

### Task 5: Documentation And Runtime Verification

**Files:**
- Create: `docs/phase-7-launchagent-scheduling.md`

- [ ] Document schedule, missed-run, lock, notifications, Chrome startup, recent URL, management commands, artifacts, safety, and limitations.
- [ ] Run syntax/static/diff checks.
- [ ] Run print-plist and plutil.
- [ ] Run `run:scheduled --dry-run --no-notify`.
- [ ] Run `run:scheduled --force` while current automation Chrome is available.
- [ ] Run doctor and verify run-once compatibility without launching a second manual backup.
- [ ] Commit tracked code only; do not install LaunchAgent without exact user confirmation.
