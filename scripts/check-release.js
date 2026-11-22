// Release checks by LanternSquid.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const versions = JSON.parse(read('versions.json'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.author, 'LanternSquid');
assert.equal(manifest.isDesktopOnly, true, 'mobile stays disabled until device testing');
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.ok(!manifest.id.includes('obsidian'));
assert.match(read('LICENSE'), /MIT License[\s\S]*2026 LanternSquid/);
for (const file of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/QA.md', 'docs/RELEASE.md']) assert.ok(read(file).includes('LanternSquid'));
const main = read('main.js');
assert.ok(!/\brequire\(['"](?:fs|os|http|https|child_process|electron)['"]\)/.test(main), 'runtime uses public Obsidian and Web APIs');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(main), 'runtime makes no network requests');
assert.ok(!/\.innerHTML\s*=/.test(main), 'runtime never inserts raw HTML');
for (const name of ['main.js', 'styles.css', 'manifest.json']) {
  const demo = path.join(root, 'demo-vault', '.obsidian', 'plugins', 'visual-gantt-bases', name);
  assert.deepEqual(fs.readFileSync(demo), fs.readFileSync(path.join(root, name)), 'demo must contain release files: ' + name);
}
console.log('Version, license, privacy, API, and demo consistency checks passed');
