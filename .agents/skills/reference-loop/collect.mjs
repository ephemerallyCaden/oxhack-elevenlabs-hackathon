import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Small read-only acquisition adapter. The current agent reads and judges its
// output. No model, scheduler, checksum audit, credentials export or code execution.
const [kind, input, output, pageLimitText = '2'] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
const limit = Number(pageLimitText);
if (kind !== 'github' || !input || !output || !Number.isInteger(limit) || limit < 1 || limit > 5)
  fail('Usage: node collect.mjs github ISSUE_URL OUTPUT.json [MAX_COMMENT_PAGES=2, max 5]\nExisting output files are preserved.');
if (fs.existsSync(output)) fail('Output exists; read the saved result or choose a new file for a necessary new observation.');

function github(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
}
function errorMessage(error) {
  return (error.stderr?.toString().trim() || error.message).slice(0, 500);
}
function leadsFrom(text) {
  const urls = text.match(/https?:\/\/[^\s<>"'\x60\])]+/g) || [];
  for (const match of text.matchAll(/\bgithub[ \t]*[:：][ \t]*([\w.-]+\/[\w.-]+)/gi))
    urls.push('https://github.com/' + match[1]);
  return [...new Set(urls.map(u => u.replace(/[.,;。；]+$/, '')))];
}
async function readIssue() {
  const url = new URL(input);
  const parts = /^\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !parts) fail('Expected an original https://github.com/OWNER/REPO/issues/NUMBER URL.');
  const [, owner, repo, , number] = parts;
  const endpoint = `repos/${owner}/${repo}/issues/${number}`;
  const issue = github(endpoint);
  const result = {
    observed_at: new Date().toISOString(),
    source: { url: issue.html_url, title: issue.title, author: issue.user.login, created_at: issue.created_at, updated_at: issue.updated_at, state: issue.state, body: issue.body || '' },
    comments: [], errors: [],
    coverage: { kind: 'GitHub issue conversation', reported_comments: issue.comments, fetched_pages: 0, page_limit: limit, page_size: 30, complete_for_endpoint: false, next_page: 1, excludes: ['PR inline review comments and review threads', 'Deleted, hidden or inaccessible content', 'Substance of linked discussions until separately read'] }
  };
  const seen = new Set();
  for (let page = 1; page <= limit; page++) {
    try {
      const comments = github(`${endpoint}/comments?per_page=30&page=${page}`);
      if (!Array.isArray(comments)) fail('Comments endpoint did not return an array.');
      result.coverage.fetched_pages++;
      for (const c of comments) if (!seen.has(c.id)) {
        seen.add(c.id);
        result.comments.push({ id: String(c.id), url: c.html_url, author: c.user.login, created_at: c.created_at, updated_at: c.updated_at, body: c.body || '' });
      }
      result.coverage.next_page = page + 1;
      if (comments.length < 30) { result.coverage.complete_for_endpoint = true; result.coverage.next_page = null; break; }
    } catch (error) { result.errors.push({ stage: 'comments', page, message: errorMessage(error) }); break; }
  }
  result.coverage.collected_comments = result.comments.length;
  result.coverage.counter_agrees = issue.comments === result.comments.length;
  result.leads = leadsFrom([result.source.body, ...result.comments.map(c => c.body)].join('\n'));
  result.status = result.coverage.complete_for_endpoint && !result.errors.length ? 'collected' : 'partial';
  result.interpretation = 'Collected text is evidence to read. Closed status does not establish a fix; community claims are not local reproduction.';
  return result;
}

try {
  const result = await readIssue();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, title: result.source.title, comments: result.comments.length, coverage: result.coverage, leads: result.leads, output, next: 'Agent reads relevant comments, follows evidence and tries the task-specific operation.' }, null, 2));
  if (result.errors.length) process.exitCode = 2;
} catch (error) { console.error(errorMessage(error)); process.exitCode = 1; }
