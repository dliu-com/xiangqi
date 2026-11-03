# 中国象棋 — Xiangqi

A Xiangqi app at **https://xiangqi.dliu.com**, in Chinese by default with an English switch. Source: https://github.com/dliu-com/xiangqi. How it works, what it costs and its security review are at **https://xiangqi.dliu.com/docs**. Two people share one board, with legal-move guidance, check/checkmate/stalemate detection, move history, captures, undo, board flipping, draw, and resignation.

Check shows a prominent “将军！” banner and marks the threatened general on the board. Checkmate shows “绝杀 · 红方已输” or “绝杀 · 黑方已输”, names the winner, and stops further moves; undo and a new game remain available. These notices also appear when restoring or automatically syncing a game.

There is one shared game. Refreshing the page or opening it on another device restores the current board, side to move, history, and result. While the page is open, it checks for updates every 5 seconds so players on different devices see new moves without refreshing. Anyone opening the site can play this same game; there are no accounts or separate rooms.

Choose a viewing mode above the board:

- **2 人同一设备**: players sit opposite each other; each side's piece characters face its player, even after crossing the river. “交换上下方” swaps the seating orientation. Either side can play its turn.
- **2 人不同设备**: choose “我是红方” or “我是黑方”. Your side stays at the bottom, all pieces are readable from your screen, and the client only lets you move or resign on your own turn. It waits for and automatically syncs your opponent's move.

The viewing mode, chosen side, and shared-device seating orientation are saved only in the current browser's local storage. Switching them does not restart or write to the shared game. Side selection is a local input preference, not an authenticated seat reservation.

“全屏棋盘” expands the board to fit the screen, with turn/sync status, check/endgame notices, undo, seating swap, and an exit button. Browsers without native fullscreen use a viewport-filling board view. Exit with “退出全屏” or Escape. The former “准备落子” guidance card has been removed; piece rules remain in “行棋规则”.

## Shared dliu.com look

Like every dliu.com site, the pages use the shared UI kit described at https://files.dliu.com/dliu.com/README.md:

- `index.html`, `docs.html` and `404.html` load `https://files.dliu.com/dliu.com/ui/v1/dl.css` before `/styles.css` (the docs page also loads `dl-docs.css` between them). All use the shared `dl-header`, `dl-main` and `dl-footer` markup. The header's `dl-brand` link to `/` shows xiangqi's own logo, a white 象 on the DL blue `#209cee` (`src/favicon.svg`, also the favicon) and “中国象棋” (“Xiangqi”). `dl-nav` holds, in order, the `Docs` button (文档), “行棋规则” (Rules, board page only) and the shared `dl-language` switcher last. The footer starts with the shared DL logo (`dl-footer-logo`, `https://files.dliu.com/dliu.com/favicon.png`) linking to dliu.com, then `dliu.com · … · Docs`; the board and docs pages keep the WXF rules link. The site follows the light theme only.
- Buttons are `dl-button`, with `dl-button-primary`, `dl-button-danger` and `dl-button-link` variants. 同一设备/不同设备 and 红方/黑方 are `dl-segmented` groups marked with `aria-pressed`. The rules and confirmation dialogs are native `<dialog class="dl-dialog">` elements with `dl-dialog-head`, `dl-dialog-body` and `dl-dialog-actions`.
- `src/styles.css` keeps only app-specific rules on the shared `--dl-*` variables: the board and pieces, which keep their own wood-and-ivory design, plus player bars, notices, move history, the toolbar, fullscreen and rule rows. It defines no header, button, dialog, footer or palette styles. The shared files are never copied into this site, and no shared JavaScript is used.
- The Content-Security-Policy allows styles only from `https://files.dliu.com/dliu.com/ui/` and images only from `https://files.dliu.com/dliu.com/` besides the site itself (see Security below).
- `tests/shared-ui.test.js` guards these rules, the Docs links, the language switcher, and an English version for every Chinese text in the static pages. Check the live site with `node ../shared-resources/scripts/audit.mjs xiangqi.dliu.com`.

## Languages

Chinese is the default. The header's 中文 | English switcher (a 文/A button on narrow screens) changes the language in place, without reloading, and saves the choice in this browser's local storage as `xiangqi-language`; later visits use it. `src/i18n.js` holds the switcher, `t('中文', 'English')`, English piece names and rules, and English versions of the API's Chinese error messages. Static pages are written in Chinese with `data-en` (text), `data-en-label` (aria-label) and `data-en-content` (meta) attributes; `app.js` and `docs.js` redraw their own content on the `xiangqi-language-change` event. Piece characters and the river label stay in Chinese in both languages.

## Docs

`/docs` is `src/docs.html`, uploaded to the S3 key `docs` (no URL rewriting at the edge), with tabs for **Technical architecture**, **Cost** and **Security**. `src/docs.js` builds the tabs in both languages with `src/diagram.js`, the shared diagram kit (from traffic-monitor, as used by video). There is no API tab: the game API is internal to the page. Update the docs when the architecture, prices or security controls change.

## Security

Threat-modelled and penetration-tested against the live site on 3 November 2026; the Security tab of `/docs` lists every test, the threat model and the accepted risks. The tests led to these fixes:

- A strict Content-Security-Policy (`script-src 'self'`, no inline code, `frame-ancestors 'none'`) and a Permissions-Policy, on the pages and on `/api/game`. The API now gets the same security headers as the pages.
- CloudFront removes S3's `server`, `x-amz-version-id` and `x-amz-server-side-encryption` headers.
- The Lambda's reserved concurrency is 10, so a request flood cannot take the Lambda concurrency the account's other sites share.
- The browser checks every piece in a server response (known sides and piece types only) before drawing it.

Accepted by design: anyone can change the one shared game (there are no accounts), there is no WAF or rate limit, and the game has no backup.

## Project structure

The structure follows the other dliu.com applications:

- `src/`: HTML, CSS, and browser JavaScript, uploaded directly to S3. No frontend build or runtime dependencies. `i18n.js` is the language switcher; `docs.html`, `docs.js` and `diagram.js` are the docs page.
- `backend/`: authoritative game actions and the Lambda GET/POST handler. The server reuses the browser's move engine.
- `cdk/bin/cdk.ts`: CDK entrypoint for the `XiangqiSite` stack.
- `cdk/lib/xiangqi-site-stack.ts`: S3, CloudFront, DynamoDB, Lambda, certificate, and DNS resources.
- `cdk/test/` and `tests/`: infrastructure, game-rule, persistence, and API tests.
- `scripts/publish-site.sh`: uploads static files to this stack's bucket and invalidates CloudFront.
- `jenkins/deploy/Jenkinsfile`: deployment pipeline using the same Jenkins agent as the other apps.
- `.github/workflows/deploy.yml`: optional GitHub Actions deployment, following the `home` app's workflow.

## Hosting

The stack deploys in `eu-west-1`, imports `MainDomain` and `MainHostedZoneId`, provisions a certificate in `us-east-1`, and creates the `xiangqi` A/AAAA aliases in the existing hosted zone.

CloudFront serves `src/` from a private S3 bucket using Origin Access Control, over HTTP/2 and HTTP/3 from all edge locations. Requests to `/api/game` go to a Lambda Function URL with AWS IAM authentication, accessible through this CloudFront distribution. The browser never receives AWS credentials. POST requests include the SHA-256 payload hash required by Lambda origin access control.

The DynamoDB on-demand table stores a single item, `gameId=current`, with the complete current position and move history. Lambda validates moves, then saves with a conditional revision check. Concurrent or stale updates return HTTP 409 with the current game rather than overwriting it. There is no TTL: the game remains saved until players start another game. The table and bucket are retained if the stack is deleted.

## Edge caching and clearing

- **Cached at the edge for up to 1 day:** `app.js`, `engine.js`, `i18n.js`, `agent-tools.js`, `docs.js`, `diagram.js`, `styles.css`, and `favicon.svg`. The shared `dl.css` and DL logo are served and cached by files.dliu.com. `scripts/publish-site.sh` uploads them with `public, max-age=300, s-maxage=86400, stale-while-revalidate=86400`. The static cache policy's maximum TTL is also 1 day.
- **Always revalidated:** `index.html` and `docs` (`no-cache, max-age=0, must-revalidate`) and `404.html` (`max-age=0, must-revalidate`). CloudFront keeps error responses for 30 seconds.
- **Never cached:** `/api/game` uses the `CachingDisabled` policy and returns `no-store`. The game state is in DynamoDB, not S3.
- **How changes are cleared:** files change only through `scripts/publish-site.sh`, which `make deploy`, `make publish`, GitHub Actions, and Jenkins all use. Each publish invalidates `/*` and waits until it completes.
- **No automatic clearing:** there is no S3 → EventBridge → Lambda → CloudFront invalidation. Nothing else writes to the bucket, so the publish invalidation already covers every change. Automatic clearing would also add a second invalidation for each file on every publish. If anything starts writing edge-cached files to this bucket outside the publish script, add automatic clearing for those keys. HTML doesn't need it because it is always revalidated.

## Usage-based costs

- CloudFront uses pay-as-you-go service pricing.
- DynamoDB uses `PAY_PER_REQUEST`, with no provisioned capacity or paid point-in-time recovery.
- Lambda has no provisioned concurrency, keep-alive schedule, VPC, or NAT gateway. Its reserved concurrency of 10 costs nothing.
- No load balancer, always-on server, API Gateway, or additional DNS hosted zone is created.
- Game API logs expire after one week. S3 files and the saved game incur storage charges.
- The browser reads every 5 seconds while the page is open, as well as on initial load, focus, visibility return, reconnection, or explicit retry; it saves on game actions. Checks are skipped while another read or save is in progress. Browsers may slow timers in background tabs; returning to the page triggers an immediate check.

## Local development

Requires Node.js 22 or later. AWS CLI credentials are needed only for deployment.

```sh
npm start
```

Open http://127.0.0.1:4173/. The preview serves the same API using memory: it survives page refreshes but resets when the development server restarts. Production stores the game in DynamoDB.

## Test and deploy

```sh
make install
make test
make synth
make deploy
```

`make deploy` checks the game and infrastructure, deploys the CDK stack, uploads the website, and waits for CloudFront invalidation. It defaults to `eu-west-1`. The account must already have the shared domain exports and CDK bootstrap resources, as used by the other apps.

For later frontend-only changes, run `npm test` followed by `make publish`. If `src/engine.js` changes, redeploy the infrastructure too because Lambda uses the same rules. Run `make diff` to review infrastructure changes.

GitHub Actions uses the existing apps' `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` repository secret convention. Jenkins uses its configured deployment identity. Neither pipeline needs a continuously running application server.

## API

- `GET /api/game`: returns `{ state }` with `revision`, `board`, `turn`, `history`, `result`, and `updatedAt`.
- `POST /api/game`: accepts `{ expectedRevision, action }`.
- Actions: `{ type: 'move', from, to }`, `{ type: 'undo' }`, `{ type: 'new' }`, `{ type: 'draw' }`, `{ type: 'resign' }`.
- Board indices run from 0 at the upper-left to 89 at the lower-right in the unflipped board.

Before saving each move, the browser fetches the latest game with an uncached GET. If the revision has changed, it updates the board and asks the player to choose again without sending the move. If the check fails, the move is not sent. The conditional revision check on POST still protects against another device moving between the GET and the save.

Moves are acknowledged only after a successful save. An uncertain save request is followed by a fresh read. The board can be flipped locally without changing the shared game.

This is a casual-play ruleset. Perpetual checking/chasing, repetitions, and move-limit adjudication are left to the players; the rules dialog explains this. Up to 2,000 moves are retained per game to stay safely within DynamoDB's item-size limit.
