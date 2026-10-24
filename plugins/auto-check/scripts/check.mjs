#!/usr/bin/env node
// Runs the project's checks from <repo>/.claude/auto-check.json. Used by the Stop hook and CI.
//   --static   build/types/lint only      --dynamic  tests/smoke only      (default: both)
//   --ci       run `setup` commands first
// Exit: 0 all passed, 1 a check failed, 3 nothing configured for the requested stages.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
const configFile = path.join(root, '.claude', 'auto-check.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};

const wantStatic = !args.includes('--dynamic'), wantDynamic = !args.includes('--static');
const checks = [
  ...(wantStatic ? config.static || [] : []),
  ...(wantDynamic ? config.dynamic || [] : []),
];

if (!checks.length) {
  console.log(`NOT CONFIGURED: add commands to .claude/auto-check.json`);
  process.exit(3);
}

const run = cmd => spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' }).status ?? 1;

if (args.includes('--ci')) {
  for (const cmd of config.setup || []) {
    const code = run(cmd);
    if (code !== 0) { console.log(`FAIL setup (${cmd}) exit=${code}`); process.exit(1); }
  }
}

for (const [name, cmd] of checks) {
  // No pipes: the exit code is the command's own, so a failure can't be hidden.
  const code = run(cmd);
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name} (${cmd}) exit=${code}`);
  if (code !== 0) process.exit(1);
}
console.log('ALL CHECKS PASSED');
