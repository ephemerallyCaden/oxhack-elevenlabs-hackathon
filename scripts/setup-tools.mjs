#!/usr/bin/env node
// Check (and with --install, set up) this machine for the team's two tools: reference-loop and auto-check.
// Same command on macOS, Linux and Windows:  node scripts/setup-tools.mjs [--install]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const install = process.argv.includes('--install');
// One command string through the shell: Windows CLIs are often .cmd shims that need it.
const sh = cmd => {
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
};
const rows = [];
const report = (status, item, detail) => rows.push({ status, item, detail });

// Shared prerequisites
const major = Number(process.versions.node.split('.')[0]);
report(major >= 22 ? 'PASS' : 'FAIL', 'Node 22+', `found ${process.versions.node}`);
const git = sh('git --version');
report(git.code === 0 ? 'PASS' : 'FAIL', 'git', git.out.split('\n')[0]);
const claude = sh('claude --version');
report(claude.code === 0 ? 'PASS' : 'FAIL', 'Claude Code', claude.code === 0 ? claude.out.split('\n')[0] : 'not found on PATH');

// reference-loop: a repo skill, so present files = available in every Claude session opened in this repo.
const refFiles = ['.claude/skills/reference-loop/SKILL.md', '.agents/skills/reference-loop/SKILL.md', '.agents/skills/reference-loop/loop.mjs'];
const missingRef = refFiles.filter(f => !fs.existsSync(path.join(root, f)));
report(missingRef.length ? 'FAIL' : 'PASS', 'reference-loop skill', missingRef.length ? `missing: ${missingRef.join(', ')} (git pull)` : 'run /reference-loop in Claude');
const loop = sh(`node "${path.join(root, '.agents/skills/reference-loop/loop.mjs')}"`);
report(/start|search|collect/.test(loop.out) ? 'PASS' : 'FAIL', 'reference-loop helper', /start|search|collect/.test(loop.out) ? 'loop.mjs runs' : loop.out.slice(0, 120));
const gh = sh('gh auth status');
report(gh.code === 0 ? 'PASS' : 'WARN', 'GitHub CLI (collector)', gh.code === 0 ? 'logged in' : 'install gh and run: gh auth login (only the GitHub collector needs it)');

// auto-check: a plugin, so it must be installed for this machine as well as present in the repo.
const pluginDir = path.join(root, 'plugins', 'auto-check');
if (!fs.existsSync(path.join(pluginDir, 'hooks', 'hooks.json'))) {
  report('FAIL', 'auto-check plugin files', 'missing: merge PR #31 / check out chore/auto-checks, then git pull');
} else {
  const listed = () => {
    try { return JSON.parse(sh('claude plugin list --json').out).some(p => String(p.id || p.name).startsWith('auto-check')); }
    catch { return /auto-check/.test(sh('claude plugin list').out); }
  };
  let installed = listed();
  if (!installed && install) {
    // Local scope: this machine and this checkout only; nothing shared is changed.
    const add = sh(`claude plugin marketplace add "${root}" --scope local`);
    const inst = sh('claude plugin install auto-check@oxhack-tools --scope local');
    installed = listed();
    if (!installed) report('FAIL', 'auto-check install', `${add.out}\n${inst.out}`.slice(-300));
  }
  report(installed ? 'PASS' : 'FAIL', 'auto-check plugin', installed ? 'installed; runs after each coding turn (restart Claude Code)' : 'not installed: run with --install');
  const run = sh(`node "${path.join(pluginDir, 'scripts', 'check.mjs')}"`);
  const ok = run.code === 0 || run.code === 3;
  report(ok ? (run.code === 3 ? 'WARN' : 'PASS') : 'FAIL', 'auto-check runner',
    run.code === 3 ? 'works; no commands yet: fill .claude/auto-check.json' : ok ? 'checks pass' : run.out.split('\n').slice(-3).join(' | '));
}

const width = Math.max(...rows.map(r => r.item.length));
for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.item.padEnd(width)}  ${r.detail}`);
const failed = rows.some(r => r.status === 'FAIL');
console.log(failed ? '\nNOT READY: fix the FAIL lines above.' : '\nREADY: both tools are available on this machine.');
process.exit(failed ? 1 : 0);
