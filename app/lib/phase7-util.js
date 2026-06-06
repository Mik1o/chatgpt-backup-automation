const fs = require('node:fs');
const path = require('node:path');

function latestMatchingFile(directory, pattern) {
  if (!fs.existsSync(directory)) return null;
  const candidates = fs.readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

module.exports = { latestMatchingFile };
