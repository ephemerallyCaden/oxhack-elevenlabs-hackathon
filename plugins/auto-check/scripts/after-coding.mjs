#!/usr/bin/env node
// Stop hook: after a turn that changed files, run static checks → tester (adds missing tests) → dynamic checks.
// The first failure is handed back to the coder once; after that it is only reported.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.AUTOCHECK_CHILD) process.exit(0); // the tester's own session must not re-trigger us

const here = path.dirname(fileURLToPath(import.meta.url)); // not URL.pathname: that gives /C:/... on Windows
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const git = (...a) => spawnSync('git', a, { cwd: input.cwd || process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').stdout.trim();
if (!root) process.exit(0);
const configFile = path.join(root, '.claude', 'auto-check.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const reply = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };

// Glob → RegExp for testGlobs (supports **, *, ?).
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  .replace(/\u0000/g, '(?:.*/)?') + '$');
const testRes = (config.testGlobs || []).map(globRe);
const isTest = f => testRes.some(r => r.test(f));
const isDoc = f => /\.(md|txt|png|jpe?g|gif|svg|webp)$/i.test(f) || f.startsWith('research/');

// When did this turn start? The last real user prompt in the transcript. Files modified since then were touched now.
function turnStart() {
  try {
    const rows = fs.readFileSync(input.transcript_path, 'utf8').trim().split('\n');
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = JSON.parse(rows[i]), c = r.message?.content;
      const prompt = typeof c === 'string' || (Array.isArray(c) && !c.some(x => x?.type === 'tool_result'));
      if (r.type === 'user' && !r.isMeta && prompt && r.timestamp) return Date.parse(r.timestamp) - 2000;
    }
  } catch {}
  return 0; // unknown: treat every uncommitted change as touched
}

const since = turnStart();
const changed = git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').filter(Boolean)
  .map(l => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '') }));
const touched = changed.filter(({ file }) => {
  try { return fs.statSync(path.join(root, file)).mtimeMs >= since; } catch { return false; }
});
const work = touched.filter(c => !isDoc(c.file));
if (!work.length) process.exit(0); // nothing but docs, or a turn without edits: no check

// Static: our own diff checks, then the project's static commands.
const problems = [], warnings = [];
const deletedTests = changed.filter(c => c.code.includes('D') && isTest(c.file)).map(c => c.file);
if (deletedTests.length) problems.push(`Test files deleted: ${deletedTests.join(', ')}. Restore them, or explain why they are obsolete.`);
const editedTests = work.filter(c => c.code.includes('M') && isTest(c.file)).map(c => c.file);
if (editedTests.length) warnings.push(`Existing test files edited: ${editedTests.join(', ')}. Check that no expectation was weakened.`);
const SECRET = /\b(sk_[a-f0-9]{40,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,})\b/;
for (const { code, file } of work) {
  let text = '';
  if (code === '??') { try { const p = path.join(root, file); if (fs.statSync(p).size < 1e6) text = fs.readFileSync(p, 'utf8'); } catch {} }
  else text = git('diff', 'HEAD', '--', file).stdout.split('\n').filter(l => l.startsWith('+')).join('\n');
  if (SECRET.test(text)) problems.push(`Possible API key in ${file}. Move it to .env.`);
}

const runChecks = flag => {
  const r = spawnSync(process.execPath, [path.join(here, 'check.mjs'), flag], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-40).join('\n') };
};
const stat = runChecks('--static');
if (stat.code === 1) problems.push(`Static checks failed:\n${stat.out}`);

// Tester: a separate Claude session that may only write test files. Once per round, only when source changed.
let tester = 'skipped';
const source = work.filter(c => !isTest(c.file)).map(c => c.file);
const t = config.tester || {};
if (!problems.length && t.enabled && t.testCommand && source.length && !input.stop_hook_active) {
  const diff = git('diff', 'HEAD', '--', ...source).stdout.slice(0, 20000);
  const allowed = ['Read', 'Grep', 'Glob', `Bash(${t.testCommand} *)`, `Bash(${t.testCommand})`,
    ...(config.testGlobs || []).map(g => `Edit(${g})`)]; // Edit rules cover every file-writing tool
  const prompt = `Changed source files: ${source.join(', ')}\nTest files must match: ${(config.testGlobs || []).join(', ')}\n` +
    `Run tests with exactly: ${t.testCommand}\n(no cd, pipes or other shell commands: they are blocked. Use Read/Grep/Glob to look at files.)\n\n` +
    `Diff (new files are listed above but not shown here):\n${diff}`;
  const args = ['-p', '--append-system-prompt-file', path.join(here, '..', 'prompts', 'tester.md'),
    // --safe-mode: no plugins/hooks/CLAUDE.md in the child (keeps login). dontAsk denies anything not allowed below.
    '--safe-mode', '--tools', 'Read,Grep,Glob,Edit,Write,Bash',
    '--permission-mode', 'dontAsk', '--allowedTools', allowed.join(' '),
    '--model', t.model || 'sonnet', '--max-budget-usd', String(t.maxBudgetUsd ?? 1), '--no-session-persistence'];
  // Prompt goes via stdin (cmd.exe caps command lines at 8191 chars). On Windows `claude` may be a .cmd shim,
  // which Node can only start through a shell, so quote every argument there.
  const win = process.platform === 'win32';
  const r = spawnSync(win ? `claude ${args.map(a => `"${a}"`).join(' ')}` : 'claude', win ? [] : args,
    { input: prompt, shell: win, cwd: root, encoding: 'utf8', env: { ...process.env, AUTOCHECK_CHILD: '1' }, timeout: (t.timeoutSec || 300) * 1000, maxBuffer: 64 * 1024 * 1024 });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  tester = r.status === 0 && /^(TESTS ADDED|NO TESTS NEEDED)/.test(last) ? last : `did not finish (${r.error?.code || `exit ${r.status}`})`;
  if (!tester.startsWith('TESTS') && !tester.startsWith('NO TESTS')) warnings.push(`Tester ${tester}. Tests for this change may be missing.`);
}

// Dynamic: run tests (including any the tester just added).
const dyn = problems.length ? { code: null } : runChecks('--dynamic');
if (dyn.code === 1) problems.push(`Tests failed:\n${dyn.out}`);

const status = c => (c === 0 ? 'passed' : c === 3 ? 'not configured' : c === null ? 'not run' : 'FAILED');
const header = `Auto-check: static ${status(stat.code)} · tester ${tester} · dynamic ${status(dyn.code)}`;
const notes = warnings.length ? `\n⚠ ${warnings.join('\n⚠ ')}` : '';

const nothingRan = stat.code === 3 && dyn.code === 3; // a check that tested nothing must not look like a pass
if (!problems.length) reply({ systemMessage: `${nothingRan ? '⚠' : '✓'} ${header}${notes}` });
const summary = `${header}\n\n${problems.join('\n\n')}${notes}`;
// Already handed back once this round: stop looping and show the human.
if (input.stop_hook_active) reply({ systemMessage: `✗ ${summary}\n\nStill failing after one fix round. Consider /reference-loop on this error.` });
reply({
  decision: 'block',
  systemMessage: `✗ ${header}. Handing back to Claude once.`,
  reason: `${summary}\n\nFix it using the /fix process: smallest change to the code, at most 3 cycles. ` +
    `Fix the code, not the tests. Tests may have been written by the auto-check tester from the intended behaviour; ` +
    `if one looks wrong, stop and say so instead of editing it. ` +
    `If it still fails after 3 cycles, stop, report what you tried, and suggest /reference-loop for this error. ` +
    `The hook re-runs when you stop, so you don't need to run the full check yourself.`,
});
