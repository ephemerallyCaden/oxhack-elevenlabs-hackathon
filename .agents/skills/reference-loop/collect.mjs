import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Small read-only acquisition adapter. The current agent reads and judges its
// output. No model, scheduler, checksum audit, credentials export or code execution.
const [kind, input, output, pageLimitText = '2'] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
const limit = Number(pageLimitText);
if (!['github', 'bilibili'].includes(kind) || !input || !output || !Number.isInteger(limit) || limit < 1 || limit > 5)
  fail('Usage: node collect.mjs github ISSUE_URL OUTPUT.json [MAX_COMMENT_PAGES=2, max 5]\n       node collect.mjs bilibili BV_ID OUTPUT.json\nBilibili reads metadata and one comment sample. Existing output files are preserved.');
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
async function publicJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const raw = await response.text();
  if (!response.ok) fail(`HTTP ${response.status}`);
  let result;
  try { result = JSON.parse(raw); } catch { fail('Expected JSON; a browser/access page may have been returned.'); }
  if (result.code !== 0) fail(`Platform response ${result.code}: ${result.message || 'unavailable'}`);
  return result.data;
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
function reply(r) {
  return { id: r.rpid_str || String(r.rpid), parent_id: r.parent_str || String(r.parent), root_id: r.root_str || String(r.root), created_at: r.ctime ? new Date(r.ctime * 1000).toISOString() : null, text: r.content?.message || '', reported_child_count: r.rcount || 0 };
}
async function readBilibili() {
  if (!/^BV[A-Za-z0-9]{10}$/.test(input)) fail('Expected one BV video identifier.');
  const metadataUrl = 'https://api.bilibili.com/x/web-interface/view?bvid=' + input;
  const metadata = await publicJSON(metadataUrl);
  const result = { observed_at: new Date().toISOString(), source: { platform: 'bilibili', bvid: input, url: `https://www.bilibili.com/video/${input}/`, metadata_url: metadataUrl, title: metadata.title, description: metadata.desc || '', published_at: metadata.pubdate ? new Date(metadata.pubdate * 1000).toISOString() : null }, comments: [], errors: [], coverage: { kind: 'One public comment sample', requested_page: 1, requested_page_size: 20, sort: 2, reported_video_comment_count: metadata.stat?.reply, later_pages_read: false, child_reply_pages_read: false, complete_discussion: false } };
  const commentsUrl = `https://api.bilibili.com/x/v2/reply?type=1&oid=${metadata.aid}&pn=1&ps=20&sort=2`;
  result.coverage.comments_url = commentsUrl;
  try {
    const data = await publicJSON(commentsUrl);
    result.coverage.api_page = data.page || null;
    const roots = new Map();
    const add = (r, position) => {
      if (!r) return;
      const key = r.rpid_str || String(r.rpid), prior = roots.get(key);
      if (prior) {
        if (!prior.positions.includes(position)) prior.positions.push(position);
        // Pinned and ordinary listings can expose different subsets of replies.
        // Merge child IDs so deduplicating a root does not erase useful context.
        const children = new Map(prior.embedded_replies.map(child => [child.id, child]));
        for (const child of r.replies || []) { const item = reply(child); children.set(item.id, item); }
        prior.embedded_replies = [...children.values()];
        return;
      }
      roots.set(key, { ...reply(r), positions: [position], embedded_replies: (r.replies || []).map(reply) });
    };
    for (const [position, r] of Object.entries(data.top || {})) if (r && typeof r === 'object' && r.rpid) add(r, 'pinned:' + position);
    for (const r of data.top_replies || []) add(r, 'top_replies');
    for (const r of data.replies || []) add(r, 'page');
    result.comments = [...roots.values()];
    result.coverage.collected_roots = result.comments.length;
    result.coverage.collected_embedded_replies = result.comments.reduce((n, r) => n + r.embedded_replies.length, 0);
    result.status = 'sample_collected';
  } catch (error) { result.status = 'metadata_only'; result.errors.push({ stage: 'comments', message: errorMessage(error) }); }
  result.leads = leadsFrom([result.source.description, ...result.comments.flatMap(c => [c.text, ...c.embedded_replies.map(r => r.text)])].join('\n'));
  result.interpretation = 'Read useful discussion context and follow original project leads. This is a bounded public sample, not all comments or a claim that the third-party CLI bug is fixed.';
  return result;
}

try {
  const result = kind === 'github' ? await readIssue() : await readBilibili();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, title: result.source.title, comments: result.comments.length, coverage: result.coverage, leads: result.leads, output, next: 'Agent reads relevant comments, follows evidence and tries the task-specific operation.' }, null, 2));
  if (result.errors.length) process.exitCode = 2;
} catch (error) { console.error(errorMessage(error)); process.exitCode = 1; }
