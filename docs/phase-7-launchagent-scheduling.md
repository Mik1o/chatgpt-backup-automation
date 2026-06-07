# Phase 7 LaunchAgent Scheduling

## A. Goal

Phase 7 adds a noninteractive scheduled backup command, daily schedule gates, a shared project lock, local notifications, automation-Chrome startup support, recent-chat state, and user-confirmed LaunchAgent management.

## B. LaunchAgent And Scheduled Runner

LaunchAgent triggers `scripts/run-scheduled.sh` at 09:30 and every 30 minutes. The lightweight internal schedule gate decides whether a real backup is due. The calendar trigger starts promptly at 09:30, while the interval trigger avoids depending on launchd to replay an exact event after sleep or shutdown.

## C. Authentication Boundary

Scheduled runs never enter credentials or bypass Cloudflare, 2FA, CAPTCHA, or other interactive checks. Missing login, unhealthy pages, or a missing extension bridge stop the run and produce a failure summary and notification.

## D. Schedule Gate

Default schedule:

```json
{
  "enabled": true,
  "target_hour": 9,
  "target_minute": 30,
  "check_interval_minutes": 30,
  "max_scheduled_attempts_per_day": 1,
  "allow_auto_start_chrome": true,
  "notify_success": true,
  "notify_partial": true,
  "notify_failure": true,
  "notify_skipped": false
}
```

Before 09:30, after a success on the same local date, or after the daily attempt limit, automatic runs are skipped. `--force` bypasses these daily gates but still requires the lock and fatal preflight.

Forced runs do not consume the daily automatic-attempt allowance.

## E. Missed-Run Policy

`RunAtLoad`, `StartCalendarInterval=09:30`, and `StartInterval=1800` trigger checks. If the Mac was asleep or off at 09:30, the first later interval/load trigger runs once when no success or attempt exists for that local date.

## F. Lock

Both `run:once` and `run:scheduled` use:

```text
.local/state/run.lock
```

An active lock produces `skipped_locked`. Dead-PID, unreadable, or older-than-four-hours locks are treated as stale, recorded as warnings, and replaced. The lock is released after success, failure, or handled exceptions.

## G. Notifications

Notifications use macOS `/usr/bin/osascript`. Success, partial, and failure notifications are enabled by default; skipped notifications are disabled. Notification failure is recorded as a warning and does not fail the backup.

## H. Automation Chrome Auto-Start

If CDP is unavailable and auto-start is enabled, scheduled mode launches Google Chrome with the isolated automation profile, loopback CDP, and no first-run/default-browser prompts. It does not use `--load-extension`, does not use the daily profile, and does not kill Chrome.

After Chrome auto-start, scheduled preflight retries the extension bridge for up to 30 seconds so a slowly restored unpacked extension does not cause an immediate false failure.

## I. Last-Known Recent URL

Successful manual and scheduled runs store a validated non-project conversation URL at:

```text
.local/state/last-known-chatgpt.json
```

Scheduled mode uses an already-open recent page first, then this saved URL. Project URLs are rejected. If neither exists, the scheduled run fails and asks for a successful manual `run:once`.

## J. Commands

```sh
.local/bin/npm run run:scheduled
.local/bin/npm run run:scheduled -- --dry-run --no-notify
.local/bin/npm run run:scheduled -- --force
.local/bin/npm run launchagent:print-plist
.local/bin/npm run launchagent:status
.local/bin/npm run launchagent:install
.local/bin/npm run launchagent:uninstall
.local/bin/npm run launchagent:kickstart
```

Mutating LaunchAgent commands require exact interactive confirmation: `INSTALL`, `UNINSTALL`, or `KICKSTART`. Install is never performed automatically.

For machine-readable plist redirection without npm's command banner:

```sh
.local/bin/npm run --silent launchagent:print-plist > /tmp/chatgpt-backup.plist
/usr/bin/plutil -lint /tmp/chatgpt-backup.plist
```

## K. Runtime Artifacts

```text
.local/state/scheduler-state.json
.local/state/last-known-chatgpt.json
.local/state/run.lock
.local/state/run-scheduled-summary-<runId>.json
.local/logs/run-scheduled-<runId>.log
.local/logs/launchagent.out.log
.local/logs/launchagent.err.log
```

Installed plist path:

```text
/Users/one/Library/LaunchAgents/com.local.chatgpt-backup-automation.plist
```

## L. Status

- `success`: scheduled export and organizer both succeeded.
- `partial`: recent succeeded, but a project or organizer warning remains.
- `failed`: lock-independent preflight, recent export, organizer, or index failure.
- `skipped_*`: daily gate, disabled schedule, or active lock prevented a run.

## M. Safety

Scheduled mode does not delete staging ZIPs, old archive Markdown, unseen archive records, logs, state, screenshots, or Chrome profiles. It does not close Chrome or commit runtime files and real data.

## N. Known Limitations

- The isolated automation profile must retain a manually loaded unpacked extension.
- Login, Cloudflare, 2FA, and CAPTCHA remain interactive blockers.
- Account email is not automatically verified from ChatGPT UI.
- Project discovery still depends on current ChatGPT DOM structure.
- LaunchAgent execution inherits macOS GUI-session and notification restrictions.

## O. Phase 8

Phase 8 may improve account verification, operator-facing diagnostics, retention policy, and long-term monitoring. Do not begin it until scheduled runs and any chosen LaunchAgent installation have been observed in normal use.

## P. Phase 7 Verification

Verified on June 6, 2026:

- `run:scheduled --dry-run --no-notify` passed without export or organizer activity.
- An initial forced run failed safely because no last-known recent URL existed; lock release and failure notification passed.
- The recent URL from the previously successful Phase 6 run was validated and migrated into ignored runtime state.
- A second forced scheduled run succeeded: recent plus four projects, five ZIPs, 29 Markdown entries, zero failed ZIPs, and a successful notification.
- The next ordinary scheduled trigger returned `skipped_success_today` without repeating the backup.
- Manual `run:once` returned `skipped_locked` while a scheduled lock was active, without prompting or exporting.
- Plist rendering and `plutil -lint` passed.
- LaunchAgent remains uninstalled because no exact `INSTALL` confirmation was provided.

Post-install validation on June 7, 2026:

- LaunchAgent install, `RunAtLoad`, before-schedule skip, status, and kickstart were observed.
- A forced auto-start run initially failed because the unpacked extension bridge was not ready immediately after Chrome exposed CDP; scheduled preflight now retries bridge readiness for up to 30 seconds.
- Forced runs no longer consume the daily automatic-attempt allowance, so operator diagnostics before 09:30 cannot block the day's normal scheduled run.
- A calendar trigger was added after observing that `StartInterval=1800` alone fired at 09:28 and would not run again until roughly 09:58; this was scheduling phase alignment, not a timezone error.
