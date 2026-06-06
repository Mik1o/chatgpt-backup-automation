# Phase 6 Manual E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only doctor command and a manual end-to-end command that chains the existing Phase 4 export and Phase 5 organizer workflows.

**Architecture:** Keep Phase 4 and Phase 5 behavior intact and expose their existing `run()` functions for in-process orchestration. Add one focused Phase 6 shared module for config validation, preflight checks, bridge ping, status aggregation, and summary construction. Doctor and run-once remain thin CLI entrypoints.

**Tech Stack:** Node.js CommonJS, Playwright CDP, Chrome extension content script, existing Phase 4/5 workflows.

---

### Task 1: Define Phase 6 Contracts With Static Tests

**Files:**
- Create: `tests/phase6-static.test.js`
- Create: `app/lib/phase6.js`

- [ ] Write failing assertions for config validation, fatal/warning policy, status aggregation, ping message shape, summary shape, and no-deletion flags.
- [ ] Run `.local/bin/npm run test:phase6-static` and confirm it fails because the Phase 6 module does not exist.
- [ ] Implement the minimum pure helpers in `app/lib/phase6.js`.
- [ ] Run the static test and confirm it passes.

### Task 2: Add Extension Ping

**Files:**
- Modify: `extension/chatgpt-backup/scripts/content-script.js`
- Test: `tests/phase6-static.test.js`

- [ ] Add failing source assertions for `PING` and `PING_RESULT`.
- [ ] Add a content-script-local ping response that does not call the service worker or read page content.
- [ ] Run Phase 2, Phase 3C filename, and Phase 6 static tests.

### Task 3: Add Doctor

**Files:**
- Create: `app/doctor.js`
- Modify: `package.json`
- Test: `tests/phase6-static.test.js`

- [ ] Add failing source/package assertions for the doctor CLI and JSON summary.
- [ ] Implement writable-path checks, dependency checks, optional CDP/page/ping checks, and runtime inventory checks.
- [ ] Run syntax checks and `.local/bin/npm run doctor`; confirm CDP absence is warning-only.

### Task 4: Make Existing Workflows Callable

**Files:**
- Modify: `app/phase4-run-once-backup.js`
- Modify: `app/phase5-organize-archive.js`
- Test: `tests/phase4-static.test.js`
- Test: `tests/phase5-static.test.js`
- Test: `tests/phase6-static.test.js`

- [ ] Add failing assertions that both modules export `run`.
- [ ] Return summary objects and paths from existing workflow functions without changing CLI behavior.
- [ ] Let Phase 4 skip its duplicate confirmation when called by run-once.
- [ ] Let Phase 5 accept an explicit Phase 4 summary path when called by run-once.
- [ ] Run all Phase 4/5/6 static tests.

### Task 5: Add Manual Run-Once Orchestrator

**Files:**
- Create: `app/run-once.js`
- Modify: `package.json`
- Test: `tests/phase6-static.test.js`

- [ ] Add failing source/package assertions for `run:once`, unified log, summary, preflight, Phase 4 call, and Phase 5 call.
- [ ] Implement fatal preflight, one explicit account confirmation, export/organizer chaining, failure-stage reporting, unified artifacts, and status aggregation.
- [ ] Run syntax and static tests.

### Task 6: Document and Verify

**Files:**
- Create: `docs/phase-6-manual-e2e.md`

- [ ] Document goals, architecture, manual prerequisites, doctor/run-once usage, statuses, artifacts, safety, limitations, and Phase 7 recommendation.
- [ ] Run all requested syntax/static checks and `git diff --check`.
- [ ] Run doctor.
- [ ] Run real `run:once` only if automation Chrome/CDP prerequisites are available; otherwise record the preflight failure honestly.
- [ ] Verify `.local/` remains ignored and commit only source, tests, docs, package metadata, and extension source.
