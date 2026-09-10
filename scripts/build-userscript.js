'use strict';

// Builds the Greasyfork/Tampermonkey userscript from the extension source.
// manifest.json is the single source of truth: version, description, @match
// list, run_at and the ordered js list are all derived from it, so there is
// nothing to keep in sync by hand. Zero dependencies.

const fs = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/yingyx/reprice-artificial-analysis';

// English is the primary language; Chinese variant for script-manager prompts.
const DESCRIPTION_ZH = '用你实际支付的价格重新计算 Artificial Analysis 基准。';

function buildUserscript(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
  const cs = manifest.content_scripts[0];

  const header = [
    '// ==UserScript==',
    `// @name         ${manifest.name}`,
    `// @namespace    ${REPO_URL}`,
    `// @version      ${manifest.version}`,
    `// @description  ${manifest.description}`,
    `// @description:zh-CN  ${DESCRIPTION_ZH}`,
    '// @author       yingyx'
  ]
    .concat(cs.matches.map(m => `// @match        ${m}`))
    .concat([
      `// @run-at       ${cs.run_at.replace(/_/g, '-')}`,
      '// @grant        none',
      '// @license      MIT',
      `// @homepageURL  ${REPO_URL}`,
      `// @supportURL   ${REPO_URL}/issues`,
      '// ==/UserScript==',
      ''
    ]);

  const body = cs.js
    .map(rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8').trim())
    .join('\n\n');

  return header.join('\n') + body + '\n';
}

module.exports = { buildUserscript, REPO_URL };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('usage: node scripts/build-userscript.js <output.user.js>');
    process.exit(1);
  }
  const code = buildUserscript(root);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, code);
  console.log('wrote ' + outPath + ' (' + code.length + ' bytes)');
}
