const protocol = {
  constants: {
    pageSource: 'CHATGPT_BACKUP_AUTOMATION',
    extensionSource: 'CHATGPT_BACKUP_EXTENSION',
    requestType: 'EXPORT_MARKDOWN_ZIP',
    responseType: 'EXPORT_MARKDOWN_ZIP_RESULT',
    runtimeMessage: 'CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP',
  },
  request: {
    source: 'CHATGPT_BACKUP_AUTOMATION',
    type: 'EXPORT_MARKDOWN_ZIP',
    requestId: 'example-request-id',
    payload: {
      bucket: 'project',
      name: 'Example Project',
      backupRunId: '2026-06-01_093000',
    },
  },
  response: {
    source: 'CHATGPT_BACKUP_EXTENSION',
    type: 'EXPORT_MARKDOWN_ZIP_RESULT',
    requestId: 'example-request-id',
    ok: true,
    result: {
      filename: 'chatgpt-backup__project__Example Project__2026-06-01_093000.zip',
      bucket: 'project',
      name: 'Example Project',
      backupRunId: '2026-06-01_093000',
      downloadId: 123,
    },
  },
};

document.getElementById('protocol').textContent = JSON.stringify(protocol, null, 2);
