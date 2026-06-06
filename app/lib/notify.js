const { execFileSync } = require('node:child_process');

function buildNotification({ status, runId, failureStage, zipCount = 0, markdownCount = 0 }) {
  const suffix = runId ? ` Run: ${runId}` : '';
  if (status === 'success') return { title: 'ChatGPT Backup', message: `Backup succeeded: ${zipCount} ZIPs, ${markdownCount} Markdown, archive updated.${suffix}` };
  if (status === 'partial') return { title: 'ChatGPT Backup', message: `Backup partially completed. Check logs.${suffix}` };
  if (status === 'failed') return { title: 'ChatGPT Backup', message: `Backup failed at ${failureStage || 'unknown'}. Check logs.${suffix}` };
  return { title: 'ChatGPT Backup', message: `Backup skipped: ${status}.${suffix}` };
}

function sendNotification(notification) {
  const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    execFileSync('/usr/bin/osascript', ['-e', `display notification "${escape(notification.message)}" with title "${escape(notification.title)}"`], { stdio: 'ignore' });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

module.exports = { buildNotification, sendNotification };
