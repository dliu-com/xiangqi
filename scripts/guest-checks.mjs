// Runs every guest check from src/health-checks.js against the live site, as status.dliu.com does
// (make guest-check). GET/HEAD only, no cookies, never a write. Exits 1 if any check fails.
import { CHECKS } from '../src/health-checks.js';

const UA = 'dliu-status-bot/1.0 (+https://status.dliu.com/docs)';
let failures = 0;

async function run(check) {
  const started = Date.now();
  const response = await fetch(check.url, { method: check.method, redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  const elapsed = Date.now() - started;
  const body = check.method === 'HEAD' ? '' : await response.text();
  const problems = [];
  if (response.status !== check.status) problems.push(`status ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (check.type && type !== check.type) problems.push(`type ${type}`);
  if (check.location && !(response.headers.get('location') || '').startsWith(check.location)) problems.push(`location ${response.headers.get('location')}`);
  if (check.marker && !check.json && !body.includes(check.marker)) problems.push('marker missing');
  if (check.marker && check.json) {
    try { if (!(check.marker in JSON.parse(body))) problems.push('JSON key missing'); } catch { problems.push('not JSON'); }
  }
  const slow = check.slowMs && elapsed > check.slowMs ? ' (slow)' : '';
  return { problems, note: `${response.status} ${type || '-'} ${elapsed} ms${slow}` };
}

for (const check of CHECKS) {
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { result = await run(check); } catch (error) { result = { problems: [error.name], note: error.name }; }
    if (!result.problems.length) break;
  }
  if (result.problems.length) failures++;
  console.log(`${result.problems.length ? '✗' : '✓'} ${check.fn.padEnd(11)} ${check.method.padEnd(4)} ${check.url}  ${result.note}${result.problems.length ? `  — ${result.problems.join(', ')}` : ''}`);
}
console.log(failures ? `\n${failures} guest check(s) failed.` : '\nEvery guest check passed.');
process.exitCode = failures ? 1 : 0;
