// Test runner by LanternSquid. No package installation is required.
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const commands = [['--check', 'main.js'], ['tests/logic.test.js'], ['tests/reliability.test.js'], ['tests/smoke.test.js'], ['tests/export.test.js'], ['scripts/check-release.js']];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
