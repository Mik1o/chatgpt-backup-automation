const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../extension/chatgpt-backup/jszip.js');

const PROJECT_ROOT = '/Users/one/chatgpt-backup-automation';
const CONFIG_PATH = path.join(PROJECT_ROOT, '.local', 'config.json');
const STATE_DIR = path.join(PROJECT_ROOT, '.local', 'state');
const LOG_DIR = path.join(PROJECT_ROOT, '.local', 'logs');
const TMP_DIR = path.join(PROJECT_ROOT, '.local', 'tmp');
const STAGING_DIR = '/Users/one/Downloads/ChatGPT_Backup_Staging';
const TEMPLATE_EMAIL = 'REPLACE_WITH_TARGET_CHATGPT_EMAIL';
const organizerRunId = `phase5-organize-${localTimestamp()}`;
const logPath = path.join(LOG_DIR, `phase5-organize-${organizerRunId}.log`);
const organizerSummaryPath = path.join(STATE_DIR, `phase5-organize-summary-${organizerRunId}.json`);
const organizerTmpRoot = path.join(TMP_DIR, 'phase5-organize', organizerRunId);

let logStream = null;

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function sanitizePathSegment(value = 'untitled') {
  return String(value)
    .replace(/[/:\\\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .slice(0, 120) || 'untitled';
}

function yamlScalar(value) {
  if (value === null || value === undefined || value === '') return value === null ? 'null' : '""';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

function renderFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return null;
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) return null;
  const raw = markdown.slice(4, end);
  return {
    raw,
    body: markdown.slice(end + 4).replace(/^\r?\n+/, ''),
    isChatGptBackup: /^source:\s*["']?chatgpt-backup["']?\s*$/m.test(raw),
  };
}

function applyFrontmatter(markdown, fields) {
  const existing = parseFrontmatter(markdown);
  const frontmatter = renderFrontmatter(fields);
  if (!existing) return { content: `${frontmatter}\n\n${markdown.replace(/^\r?\n+/, '')}`, warning: null };
  if (existing.isChatGptBackup) return { content: `${frontmatter}\n\n${existing.body}`, warning: null };
  return {
    content: `${frontmatter}\n\n${markdown}`,
    warning: 'Existing non-chatgpt-backup frontmatter preserved below organizer frontmatter',
  };
}

function buildArchiveDirectory(accountRoot, bucket, projectName, recentBucketName) {
  if (bucket === 'recent') return path.join(accountRoot, sanitizePathSegment(recentBucketName));
  if (bucket === 'project') return path.join(accountRoot, sanitizePathSegment(projectName));
  throw new Error(`Invalid bucket: ${bucket}`);
}

function chooseArchiveFilename(directory, title, conversationId, sourceEntry, content) {
  const safeTitle = sanitizePathSegment(title || path.basename(sourceEntry, path.extname(sourceEntry)));
  const plain = `${safeTitle}.md`;
  if (!fs.existsSync(path.join(directory, plain))) return plain;
  const suffix = conversationId
    ? sanitizePathSegment(conversationId).slice(0, 8)
    : sanitizePathSegment(path.basename(sourceEntry, path.extname(sourceEntry))).slice(0, 32) || shortHash(content);
  return `${safeTitle}__${suffix}.md`;
}

function makeWeakKey({ bucket, projectName, sourceEntry }) {
  return `${bucket}|${projectName || ''}|${sourceEntry}`;
}

function assertWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path is outside allowed root: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function validateSourceZipPath(zipPath) {
  const resolved = path.resolve(zipPath);
  try {
    assertWithin(STAGING_DIR, resolved);
  } catch (_error) {
    throw new Error(`ZIP is outside staging: ${resolved}`);
  }
  const basename = path.basename(resolved);
  if (basename === 'download.zip') throw new Error('Refusing download.zip');
  if (!/^chatgpt-backup__(recent|project)__.+\.zip$/.test(basename)) {
    throw new Error(`Invalid backup ZIP filename: ${basename}`);
  }
  return resolved;
}

function updateIndex(existingIndex, { run, conversations }) {
  const index = {
    ...existingIndex,
    runs: Array.isArray(existingIndex.runs) ? [...existingIndex.runs] : [],
    conversations: Array.isArray(existingIndex.conversations) ? [...existingIndex.conversations] : [],
  };
  index.runs.push(run);

  for (const incoming of conversations) {
    const position = index.conversations.findIndex((item) => (
      incoming.conversation_id
        ? item.conversation_id === incoming.conversation_id
        : !item.conversation_id && item.weak_key === incoming.weak_key
    ));
    if (position >= 0) index.conversations[position] = { ...index.conversations[position], ...incoming };
    else index.conversations.push(incoming);
  }
  return index;
}

function determineOrganizerStatus({ failedZips, warnings, error }) {
  if (error) return error.startsWith('Created config template') ? 'partial' : 'failed';
  return failedZips || warnings.length ? 'partial' : 'success';
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function log(message, meta = undefined) {
  const line = `${new Date().toISOString()} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`;
  console.log(line);
  if (logStream) logStream.write(`${line}\n`);
}

function parseArgs(argv) {
  const summaryIndex = argv.indexOf('--summary');
  return { summaryPath: summaryIndex >= 0 ? argv[summaryIndex + 1] : null };
}

function findLatestPhase4Summary() {
  const candidates = fs.readdirSync(STATE_DIR)
    .filter((name) => /^phase4-run-summary-.*\.json$/.test(name))
    .map((name) => path.join(STATE_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) throw new Error('No Phase 4 summary JSON found');
  return candidates[0];
}

function createConfigTemplate() {
  ensureDir(path.dirname(CONFIG_PATH));
  atomicWrite(CONFIG_PATH, `${JSON.stringify({
    target_email: TEMPLATE_EMAIL,
    archive_root: '/Users/one/Documents/ChatGPT_Backups',
    recent_bucket_name: '最近对话',
  }, null, 2)}\n`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    createConfigTemplate();
    throw new Error(`Created config template at ${CONFIG_PATH}. Fill target_email and rerun.`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!config.target_email || config.target_email === TEMPLATE_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.target_email)) {
    throw new Error(`Invalid target_email in ${CONFIG_PATH}`);
  }
  if (!config.archive_root || !path.isAbsolute(config.archive_root)) throw new Error('archive_root must be an absolute path');
  if (!config.recent_bucket_name) config.recent_bucket_name = '最近对话';
  return config;
}

function loadAndValidatePhase4Summary(summaryPath) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (!summary.runId || !summary.recent || !Array.isArray(summary.projects)) throw new Error('Invalid Phase 4 summary structure');
  if (summary.recent.status !== 'success') throw new Error('Phase 4 recent export was not successful');
  if (!summary.recent.zipPath) throw new Error('Phase 4 recent ZIP path is missing');
  for (const project of summary.projects) {
    if (!project.name || !project.status) throw new Error('Invalid Phase 4 project entry');
    if (project.status === 'success' && !project.zipPath) throw new Error(`Successful project ZIP missing: ${project.name}`);
  }
  return summary;
}

async function extractMarkdownEntries(zipPath, targetDir) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.md$/i.test(entry.name));
  if (!entries.length) throw new Error('ZIP contains no Markdown files');
  ensureDir(targetDir);
  const extracted = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (path.isAbsolute(entry.name) || entry.name.split(/[\\/]/).includes('..')) {
      throw new Error(`Unsafe ZIP entry: ${entry.name}`);
    }
    const temporaryPath = assertWithin(targetDir, path.join(targetDir, `${String(index + 1).padStart(4, '0')}.md`));
    fs.writeFileSync(temporaryPath, await entry.async('nodebuffer'));
    extracted.push({ path: temporaryPath, sourceEntry: entry.name });
  }
  atomicWrite(path.join(targetDir, '_entries.json'), `${JSON.stringify(extracted.map((entry) => ({
    sourceEntry: entry.sourceEntry,
    temporaryFile: path.basename(entry.path),
  })), null, 2)}\n`);
  return extracted;
}

function extractMetadata(markdown, sourceEntry) {
  const existing = parseFrontmatter(markdown);
  const searchArea = existing?.raw || '';
  const findValue = (key) => {
    const match = searchArea.match(new RegExp(`^${key}:\\s*[\"']?([^\\n\"']+)`, 'm'));
    return match?.[1]?.trim() || null;
  };
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const basename = path.basename(sourceEntry, path.extname(sourceEntry));
  const conversationId = findValue('conversation_id')
    || markdown.match(/\/c\/([a-z0-9-]{16,})/i)?.[1]
    || markdown.match(/\b([0-9a-f]{8}-[0-9a-f-]{20,})\b/i)?.[1]
    || null;
  return {
    title: findValue('title') || heading || basename,
    conversationId,
    branchId: findValue('branch_id'),
    createdAt: findValue('created_at'),
    updatedAt: findValue('updated_at'),
  };
}

function uniqueProjectDirectories(projectNames) {
  const result = new Map();
  const used = new Map();
  for (const name of projectNames) {
    const base = sanitizePathSegment(name);
    const existing = used.get(base);
    const segment = existing && existing !== name ? `${base}__${shortHash(name)}` : base;
    used.set(base, name);
    result.set(name, segment);
  }
  return result;
}

function writeIndex(accountRoot, config, backupRunId, organizerSummary, conversations) {
  const indexPath = assertWithin(accountRoot, path.join(accountRoot, '_index.json'));
  let index = {
    schema_version: 1,
    account_email: config.target_email,
    archive_root: config.archive_root,
    recent_bucket_name: config.recent_bucket_name,
    updated_at: organizerSummary.endedAt,
    runs: [],
    conversations: [],
  };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const backupPath = path.join(accountRoot, `_index.backup-${localTimestamp()}.json`);
    fs.copyFileSync(indexPath, backupPath);
  }
  index = updateIndex(index, {
    run: {
      backup_run_id: backupRunId,
      organizer_run_id: organizerSummary.organizerRunId,
      started_at: organizerSummary.startedAt,
      ended_at: organizerSummary.endedAt,
      status: organizerSummary.status,
      zip_count: organizerSummary.totals.zipsProcessed,
      markdown_count: organizerSummary.totals.markdownWritten,
    },
    conversations,
  });
  index.schema_version = 1;
  index.account_email = config.target_email;
  index.archive_root = config.archive_root;
  index.recent_bucket_name = config.recent_bucket_name;
  index.updated_at = organizerSummary.endedAt;
  atomicWrite(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return indexPath;
}

async function run() {
  ensureDir(STATE_DIR);
  ensureDir(LOG_DIR);
  ensureDir(TMP_DIR);
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const startedAt = new Date().toISOString();
  const result = {
    organizerRunId,
    backupRunId: null,
    startedAt,
    endedAt: null,
    status: 'failed',
    configPath: CONFIG_PATH,
    archiveAccountRoot: null,
    sourceSummaryPath: null,
    processedZips: [],
    writtenMarkdown: [],
    totals: { zipsProcessed: 0, markdownWritten: 0, overwritten: 0, failedZips: 0 },
    warnings: [],
    error: null,
  };

  try {
    const config = loadConfig();
    const args = parseArgs(process.argv.slice(2));
    const sourceSummaryPath = path.resolve(args.summaryPath || findLatestPhase4Summary());
    const phase4 = loadAndValidatePhase4Summary(sourceSummaryPath);
    const accountRoot = path.resolve(config.archive_root, sanitizePathSegment(config.target_email));
    result.backupRunId = phase4.runId;
    result.sourceSummaryPath = sourceSummaryPath;
    result.archiveAccountRoot = accountRoot;
    ensureDir(accountRoot);

    const projectDirectories = uniqueProjectDirectories(phase4.projects.map((project) => project.name));
    const sources = [
      { bucket: 'recent', projectName: null, zipPath: phase4.recent.zipPath, status: phase4.recent.status },
      ...phase4.projects.map((project) => ({ bucket: 'project', projectName: project.name, zipPath: project.zipPath, status: project.status })),
    ];
    const indexPath = path.join(accountRoot, '_index.json');
    const existingIndex = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { conversations: [] };
    const indexConversations = [];
    const identityPaths = new Map((existingIndex.conversations || []).map((item) => [
      item.conversation_id ? `id:${item.conversation_id}` : `weak:${item.weak_key}`,
      item.archive_path,
    ]));

    for (const source of sources) {
      if (source.status !== 'success') {
        result.processedZips.push({ bucket: source.bucket, projectName: source.projectName, zipPath: source.zipPath || null, status: 'skipped', markdownCount: 0, error: `Source status: ${source.status}` });
        continue;
      }
      const zipResult = { bucket: source.bucket, projectName: source.projectName, zipPath: source.zipPath, status: 'failed', markdownCount: 0, error: null };
      result.processedZips.push(zipResult);
      try {
        const zipPath = validateSourceZipPath(source.zipPath);
        if (!fs.existsSync(zipPath)) throw new Error(`ZIP does not exist: ${zipPath}`);
        const extractDir = path.join(organizerTmpRoot, path.basename(zipPath, '.zip'));
        const markdownEntries = await extractMarkdownEntries(zipPath, extractDir);

        const projectSegment = source.projectName ? projectDirectories.get(source.projectName) : null;
        const archiveDir = source.bucket === 'project'
          ? path.join(accountRoot, projectSegment)
          : buildArchiveDirectory(accountRoot, 'recent', null, config.recent_bucket_name);
        assertWithin(accountRoot, archiveDir);
        ensureDir(archiveDir);

        for (const markdownEntry of markdownEntries) {
          const markdownPath = markdownEntry.path;
          const sourceEntry = markdownEntry.sourceEntry;
          const markdown = fs.readFileSync(markdownPath, 'utf8');
          const metadata = extractMetadata(markdown, sourceEntry);
          const weakKey = makeWeakKey({ bucket: source.bucket, projectName: source.projectName, sourceEntry });
          const identityKey = metadata.conversationId ? `id:${metadata.conversationId}` : `weak:${weakKey}`;
          const existing = existingIndex.conversations?.find((item) => (
            metadata.conversationId ? item.conversation_id === metadata.conversationId : !item.conversation_id && item.weak_key === weakKey
          ));
          let archivePath;
          const mappedArchivePath = identityPaths.get(identityKey);
          if (mappedArchivePath) archivePath = assertWithin(accountRoot, path.join(accountRoot, mappedArchivePath));
          else {
            archivePath = assertWithin(accountRoot, path.join(archiveDir, chooseArchiveFilename(archiveDir, metadata.title, metadata.conversationId, sourceEntry, markdown)));
            identityPaths.set(identityKey, path.relative(accountRoot, archivePath));
          }
          const overwritten = fs.existsSync(archivePath);
          const exportedAt = new Date().toISOString();
          const projectId = source.bucket === 'project'
            ? phase4.projects.find((project) => project.name === source.projectName)?.href?.match(/\/g\/([^/]+)/)?.[1] || null
            : null;
          const applied = applyFrontmatter(markdown, {
            source: 'chatgpt-backup',
            account_email: config.target_email,
            space: 'personal',
            bucket: source.bucket,
            project_name: source.projectName,
            title: metadata.title,
            exported_at: exportedAt,
            backup_run_id: phase4.runId,
            conversation_id: metadata.conversationId || undefined,
            project_id: projectId || undefined,
            branch_id: metadata.branchId || undefined,
            created_at: metadata.createdAt || undefined,
            updated_at: metadata.updatedAt || undefined,
          });
          if (applied.warning) result.warnings.push({ sourceEntry, warning: applied.warning });
          atomicWrite(archivePath, applied.content);
          const archiveRelative = path.relative(accountRoot, archivePath);
          result.writtenMarkdown.push({
            bucket: source.bucket,
            projectName: source.projectName,
            title: metadata.title,
            archivePath: archiveRelative,
            conversationId: metadata.conversationId,
            weakKey,
            overwritten,
          });
          indexConversations.push({
            conversation_id: metadata.conversationId,
            weak_key: weakKey,
            bucket: source.bucket,
            project_name: source.projectName,
            title: metadata.title,
            archive_path: archiveRelative,
            source_zip: path.basename(zipPath),
            source_entry: sourceEntry,
            first_seen_at: existing?.first_seen_at || exportedAt,
            last_seen_at: exportedAt,
            last_exported_at: exportedAt,
            backup_run_id: phase4.runId,
            organizer_run_id: organizerRunId,
          });
          zipResult.markdownCount += 1;
          log('markdown archived', { bucket: source.bucket, projectName: source.projectName, archivePath: archiveRelative, overwritten });
        }
        zipResult.status = 'success';
      } catch (error) {
        zipResult.error = error.message || String(error);
        result.totals.failedZips += 1;
        log('ZIP processing failed', { bucket: source.bucket, projectName: source.projectName, zipPath: source.zipPath, error: zipResult.error });
      }
    }

    result.totals.zipsProcessed = result.processedZips.filter((item) => item.status === 'success').length;
    result.totals.markdownWritten = result.writtenMarkdown.length;
    result.totals.overwritten = result.writtenMarkdown.filter((item) => item.overwritten).length;
    const recentResult = result.processedZips.find((item) => item.bucket === 'recent');
    if (recentResult?.status !== 'success') throw new Error(`Recent ZIP processing failed: ${recentResult?.error || 'unknown error'}`);

    result.status = determineOrganizerStatus({
      failedZips: result.totals.failedZips,
      warnings: result.warnings,
      error: null,
    });
    result.endedAt = new Date().toISOString();
    result.indexPath = writeIndex(accountRoot, config, phase4.runId, result, indexConversations);
  } catch (error) {
    result.error = error.message || String(error);
    result.endedAt = new Date().toISOString();
    result.status = determineOrganizerStatus({
      failedZips: result.totals.failedZips,
      warnings: result.warnings,
      error: result.error,
    });
    log('organizer stopped', { error: result.error });
    process.exitCode = result.status === 'partial' ? 2 : 1;
  } finally {
    if (!result.endedAt) result.endedAt = new Date().toISOString();
    atomicWrite(organizerSummaryPath, `${JSON.stringify(result, null, 2)}\n`);
    log('organizer complete', { status: result.status, totals: result.totals, organizerSummaryPath });
    if (result.status === 'partial') process.exitCode = 2;
    if (result.status === 'failed') process.exitCode = 1;
  }
}

module.exports = {
  applyFrontmatter,
  assertWithin,
  buildArchiveDirectory,
  chooseArchiveFilename,
  determineOrganizerStatus,
  extractMarkdownEntries,
  makeWeakKey,
  sanitizePathSegment,
  updateIndex,
  validateSourceZipPath,
  yamlScalar,
};

if (require.main === module) {
  run().finally(() => {
    const exitCode = process.exitCode || 0;
    if (logStream) logStream.end(() => process.exit(exitCode));
    else process.exit(exitCode);
  });
}
