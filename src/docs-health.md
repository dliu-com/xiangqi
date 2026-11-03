# DL 中国象棋 (xiangqi.dliu.com): guest testing

How to test https://xiangqi.dliu.com as an anonymous guest, for machines and AI agents. This is the full technical version of
https://xiangqi.dliu.com/docs/health and is generated from the same data (src/health-checks.js in dliu-com/xiangqi). It follows the
dliu.com health contract used by status.dliu.com.

## Rules

- Read only: send only `GET` or `HEAD`, with no cookies, no `Authorization` header and no credentials.
- Never change content: never `POST` to `/api/game`. Everybody who opens the site plays the same single game, so a
  write would disturb real players.
- User agent: `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`. traffic.dliu.com does not count it as a visit.
- Retry a failed check once in the same run. A passing check that takes longer than its "slow after" time is slow.

## Functions

A function is critical when the site counts as down without it.

| Key | Name | Critical | What it does | Implementation |
| --- | --- | --- | --- | --- |
| `pages` | Pages | yes | The board page, its styles and scripts load. | index.html, app.js, engine.js, styles.css and 404.html, served by CloudFront from a private S3 bucket. |
| `docs` | Docs | no | The documentation pages load. | /docs (architecture, cost, security), /docs/health and /docs/health.md, served from S3. |
| `game` | Shared game | yes | The shared game can be read. | GET /api/game: CloudFront → Lambda function URL (IAM-signed) → DynamoDB GetItem of the single item gameId=current. |
| `rules` | Move rules | yes | The move rules on the server work. | src/engine.js, the same file in the browser and in the Lambda; /health checks it finds Red’s 44 legal opening moves. |

## Guest checks

One row per check. "Marker" is fixed text that must appear in the response body; "JSON key" means the body must parse
as JSON with that top-level key; "Location" is the required prefix of the redirect target (do not follow it). Compare
the content type without its parameters (for example `; charset=utf-8`).

| Function | Method | URL | Status | Content type | Marker, JSON key or Location | Slow after |
| --- | --- | --- | --- | --- | --- | --- |
| pages | GET | https://xiangqi.dliu.com/ | 200 | `text/html` | Marker `id="board"` | 2000 ms |
| pages | HEAD | https://xiangqi.dliu.com/ | 200 | `text/html` | — | 2000 ms |
| pages | GET | http://xiangqi.dliu.com/ | 301 | — | Location `https://xiangqi.dliu.com/` | — |
| pages | GET | https://xiangqi.dliu.com/app.js | 200 | `text/javascript` | Marker `registerGameTools` | 2000 ms |
| pages | GET | https://xiangqi.dliu.com/styles.css | 200 | `text/css` | Marker `.board` | 2000 ms |
| pages | GET | https://xiangqi.dliu.com/no-such-page | 404 | `text/html` | Marker `dl-header` | — |
| docs | GET | https://xiangqi.dliu.com/docs | 200 | `text/html` | Marker `dl-tabs` | 2000 ms |
| docs | GET | https://xiangqi.dliu.com/docs/health | 200 | `text/html` | Marker `id="health"` | 2000 ms |
| docs | GET | https://xiangqi.dliu.com/docs/health.md | 200 | `text/markdown` | Marker `# DL 中国象棋 (xiangqi.dliu.com): guest testing` | 2000 ms |
| game | GET | https://xiangqi.dliu.com/api/game | 200 | `application/json` | JSON key `state` | 3000 ms |
| rules | GET | https://xiangqi.dliu.com/engine.js | 200 | `text/javascript` | Marker `allLegalMoves` | 2000 ms |
| game, rules | GET | https://xiangqi.dliu.com/health | 200 | `application/health+json` | JSON key `status` | 3000 ms |

`/api/game` is never cached (`Cache-Control: no-store`); each request runs the Lambda and one DynamoDB read. Its JSON is
`{ "state": { "revision", "board", "turn", "history", "result", "updatedAt" } }`.

## Health endpoint

`GET https://xiangqi.dliu.com/health` (also `HEAD`).

- Response: `Content-Type: application/health+json`, `Cache-Control: public, max-age=60`. HTTP `200` when `status`
  is `pass` or `warn`, `503` when it is `fail`. The top-level `status` is the worst of the functions' statuses.
- Body: `{ "status", "time", "functions": [{ "key", "name", "status", "output"? }] }`. `time` is UTC ISO 8601 without
  milliseconds; `output` appears only for `warn` or `fail` and is a short generic reason.
- Caching: CloudFront caches it for 60 s with a cache key of nothing, so it runs at most about once a minute per edge
  location. The CloudFront behavior forwards no cookies, no `Authorization` header and no query string, and the
  handler reads nothing from the request.
- Read only: no writes, no side effects, no third-party calls; the whole response returns within 5 s. It reveals no
  table, bucket or function names, counts or game content.

| Key | Name | What it checks | Result |
| --- | --- | --- | --- |
| `game` | Shared game storage | One DynamoDB GetItem of the fixed item gameId=current, projecting only revision, eventually consistent, 2 s timeout. | pass; warn with output "slow" over 1 s; fail with output "read failed" or "timeout". |
| `rules` | Move rules | The server’s engine.js counts Red’s legal moves from the opening position (CPU only, no reads). | pass when it is 44; otherwise fail with output "rules check failed". |

Example:

```json
{
  "status": "pass",
  "time": "2026-11-03T23:00:00Z",
  "functions": [
    { "key": "game", "name": "Shared game storage", "status": "pass" },
    { "key": "rules", "name": "Move rules", "status": "pass" }
  ]
}
```

## Not tested

- Moving, undo, draw, resign and new game: they change the one game everybody shares, so tests never submit an action. The rules and saving are covered by the unit and API tests in the repository.
- Syncing between two devices and conflict handling: these need writes and are covered by tests/client-sync.test.js.
- Browser-only features: legal-point hints, full screen, keyboard play, the language switch and local settings.
- Security behaviour (bypassing CloudFront, cross-site requests, injection): see https://xiangqi.dliu.com/docs#security and
  `make security-test` in the repository, which needs read access to the stack's AWS outputs.
