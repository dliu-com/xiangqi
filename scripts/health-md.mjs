// Writes src/docs-health.md (served as /docs/health.md) from src/health-checks.js, the same data /docs#health shows.
// Run `node scripts/health-md.mjs` after changing src/health-checks.js; tests/health.test.js fails if they differ.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITE, FUNCTIONS, HEALTH_FUNCTIONS, CHECKS, NOT_TESTED, HEALTH_EXAMPLE } from '../src/health-checks.js';

const cell = text => String(text).replace(/\|/g, '\\|');
const row = cells => `| ${cells.map(cell).join(' | ')} |`;

export function renderHealthMarkdown() {
  return `# DL 中国象棋 (xiangqi.dliu.com): guest testing

How to test ${SITE} as an anonymous guest, for machines and AI agents. This is the full technical version of the
Testing tab at ${SITE}/docs#health and is generated from the same data (src/health-checks.js in dliu-com/xiangqi). It follows the
dliu.com health contract used by status.dliu.com, which runs these checks every 15 minutes from Ireland
(eu-west-1), the US (us-east-1) and Japan (ap-northeast-1).

## Rules

- Read only: send only \`GET\` or \`HEAD\`, with no cookies, no \`Authorization\` header and no credentials.
- Never change content: never \`POST\` to \`/api/game\`. Everybody who opens the site plays the same single game, so a
  write would disturb real players.
- User agent: \`dliu-status-bot/1.0 (+https://status.dliu.com/docs)\`. traffic.dliu.com does not count it as a visit.
- Retry a failed check once in the same run. A passing check that takes longer than its "slow after" time is slow.

## Functions

A function is critical when the site counts as down without it.

${row(['Key', 'Name', 'Critical', 'What it does for a visitor', 'What is checked', 'Implementation'])}
${row(['---', '---', '---', '---', '---', '---'])}
${FUNCTIONS.map(fn => row([`\`${fn.key}\``, fn.name, fn.critical ? 'yes' : 'no', fn.whatEn, fn.en, fn.detail])).join('\n')}

## Guest checks

One row per check. "Marker" is fixed text that must appear in the response body; "JSON key" means the body must parse
as JSON with that top-level key; "Location" is the required prefix of the redirect target (do not follow it). Compare
the content type without its parameters (for example \`; charset=utf-8\`).

${row(['Function', 'Method', 'URL', 'Status', 'Content type', 'Marker, JSON key or Location', 'Slow after'])}
${row(['---', '---', '---', '---', '---', '---', '---'])}
${CHECKS.map(check => row([
    check.fn, check.method, check.url, check.status, check.type ? `\`${check.type}\`` : '—',
    check.location ? `Location \`${check.location}\`` : check.marker ? (check.json ? `JSON key \`${check.marker}\`` : `Marker \`${check.marker}\``) : '—',
    check.slowMs ? `${check.slowMs} ms` : '—',
  ])).join('\n')}

\`/api/game\` is never cached (\`Cache-Control: no-store\`); each request runs the Lambda and one DynamoDB read. Its JSON is
\`{ "state": { "revision", "board", "turn", "history", "result", "updatedAt" } }\`.

## Health endpoint

\`GET ${SITE}/health\` (also \`HEAD\`).

- Response: \`Content-Type: application/health+json\`, \`Cache-Control: public, max-age=60\`. HTTP \`200\` when \`status\`
  is \`pass\` or \`warn\`, \`503\` when it is \`fail\`. The top-level \`status\` is the worst of the functions' statuses.
- Body: \`{ "status", "time", "functions": [{ "key", "name", "status", "output"? }] }\`. \`time\` is UTC ISO 8601 without
  milliseconds; \`output\` appears only for \`warn\` or \`fail\` and is a short generic reason.
- Caching: CloudFront caches it for 60 s with a cache key of nothing, so it runs at most about once a minute per edge
  location. The CloudFront behavior forwards no cookies, no \`Authorization\` header and no query string, and the
  handler reads nothing from the request.
- Read only: no writes, no side effects, no third-party calls; the whole response returns within 5 s. It reveals no
  table, bucket or function names, counts or game content.

${row(['Key', 'Name', 'What it checks', 'Result'])}
${row(['---', '---', '---', '---'])}
${HEALTH_FUNCTIONS.map(fn => row([`\`${fn.key}\``, fn.name, fn.check, fn.result])).join('\n')}

Example:

\`\`\`json
${HEALTH_EXAMPLE}
\`\`\`

## Not tested

${NOT_TESTED.map(item => `- ${item.detail}`).join('\n')}
- Security behaviour (bypassing CloudFront, cross-site requests, injection): see ${SITE}/docs#security and
  \`make security-test\` in the repository, which needs read access to the stack's AWS outputs.
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../src/docs-health.md', import.meta.url), renderHealthMarkdown());
  console.log('Wrote src/docs-health.md');
}
