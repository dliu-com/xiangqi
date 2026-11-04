// The single source for how a guest tests xiangqi.dliu.com: /docs#health (people), /docs/health.md (machines),
// scripts/guest-checks.mjs (runs them) and tests/health.test.js (keeps them in sync with backend/handler.cjs).
export const SITE = 'https://xiangqi.dliu.com';
// This site's live results on status.dliu.com.
export const STATUS_PAGE = 'https://status.dliu.com/site/xiangqi';
// Where status.dliu.com checks from: the first three every 15 minutes, China hourly.
export const PLACES = [['爱尔兰', 'Ireland'], ['弗吉尼亚', 'Virginia'], ['东京', 'Tokyo'], ['中国', 'China']];

// critical: the site counts as down without it.
export const FUNCTIONS = [
  {
    key: 'pages', name: 'Pages', critical: true,
    zh: '棋盘页面、样式和脚本能否打开。', en: 'The board page, its styles and scripts load.',
    whatZh: '显示棋盘，让你下棋', whatEn: 'Shows the board so you can play',
    howZh: '打开首页（棋盘）、它的脚本和样式，以及一个不存在的页面', howEn: 'Opens the home page (the board), its scripts and styles, and a page that doesn’t exist',
    downZh: '访客打不开棋盘。', downEn: 'Visitors cannot open the board.',
    detail: 'index.html, app.js, engine.js, styles.css and 404.html, served by CloudFront from a private S3 bucket.',
  },
  {
    key: 'docs', name: 'Docs', critical: false,
    zh: '说明文档能否打开。', en: 'The documentation pages load.',
    whatZh: '说明网站如何运作', whatEn: 'Explains how the site works',
    howZh: '打开 /docs 和给机器读的 /docs/health.md', howEn: 'Opens /docs and /docs/health.md, the version for machines',
    downZh: '只是说明文档打不开，下棋不受影响。', downEn: 'Only the documentation is missing; playing is unaffected.',
    detail: '/docs (tabs: architecture, cost, security, health at /docs#health) and /docs/health.md, served from S3; /docs/health redirects to /docs#health.',
  },
  {
    key: 'game', name: 'Shared game', critical: true,
    zh: '能否读取大家共享的那盘棋。', en: 'The shared game can be read.',
    whatZh: '保存那盘所有设备共享的棋', whatEn: 'Keeps the one game every device shares',
    howZh: '读取 /api/game 中的当前棋局（从不走棋），并请 /health 从数据库读一次', howEn: 'Reads the current game from /api/game (never plays a move) and asks /health to read it from the database',
    downZh: '棋盘显示“同步中断”，不能走棋，也看不到对方的棋。', downEn: 'The board says sync is interrupted: nobody can move or see the other side’s moves.',
    detail: 'GET /api/game: CloudFront → Lambda function URL (IAM-signed) → DynamoDB GetItem of the single item gameId=current.',
  },
  {
    key: 'rules', name: 'Move rules', critical: true,
    zh: '服务器上的行棋规则是否正常。', en: 'The move rules on the server work.',
    whatZh: '确保只有合法的走法会被保存', whatEn: 'Makes sure only legal moves are saved',
    howZh: '请 /health 算出开局时红方的走法：必须正好是 44 种', howEn: 'Asks /health to work out Red’s opening moves: there must be exactly 44',
    downZh: '服务器无法检查走法，所有走棋都会被拒绝。', downEn: 'The server cannot check moves, so every move would be refused.',
    detail: 'src/engine.js, the same file in the browser and in the Lambda; /health checks it finds Red’s 44 legal opening moves.',
  },
];

// The functions GET /health reports, in order; backend/handler.cjs must use the same keys and names.
export const HEALTH_FUNCTIONS = [
  {
    key: 'game', name: 'Shared game storage',
    check: 'One DynamoDB GetItem of the fixed item gameId=current, projecting only revision, eventually consistent, 2 s timeout.',
    result: 'pass; warn with output "slow" over 1 s; fail with output "read failed" or "timeout".',
  },
  {
    key: 'rules', name: 'Move rules',
    check: 'The server’s engine.js counts Red’s legal moves from the opening position (CPU only, no reads).',
    result: 'pass when it is 44; otherwise fail with output "rules check failed".',
  },
];

// Guest checks: GET or HEAD only, no cookies, never a write. marker is fixed text in the body (or a JSON key when
// json is true); location is the redirect target prefix; slowMs is when a passing check counts as slow.
export const CHECKS = [
  { fn: 'pages', method: 'GET', url: `${SITE}/`, status: 200, type: 'text/html', marker: 'id="board"', slowMs: 2000 },
  { fn: 'pages', method: 'HEAD', url: `${SITE}/`, status: 200, type: 'text/html', slowMs: 2000 },
  { fn: 'pages', method: 'GET', url: 'http://xiangqi.dliu.com/', status: 301, location: `${SITE}/` },
  { fn: 'pages', method: 'GET', url: `${SITE}/app.js`, status: 200, type: 'text/javascript', marker: 'registerGameTools', slowMs: 2000 },
  { fn: 'pages', method: 'GET', url: `${SITE}/styles.css`, status: 200, type: 'text/css', marker: '.board', slowMs: 2000 },
  { fn: 'pages', method: 'GET', url: `${SITE}/no-such-page`, status: 404, type: 'text/html', marker: 'dl-header' },
  { fn: 'docs', method: 'GET', url: `${SITE}/docs`, status: 200, type: 'text/html', marker: 'id="health"', slowMs: 2000 },
  { fn: 'docs', method: 'GET', url: `${SITE}/docs/health`, status: 301, location: '/docs#health' },
  { fn: 'docs', method: 'GET', url: `${SITE}/docs/health.md`, status: 200, type: 'text/markdown', marker: '# DL 中国象棋 (xiangqi.dliu.com): guest testing', slowMs: 2000 },
  { fn: 'game', method: 'GET', url: `${SITE}/api/game`, status: 200, type: 'application/json', marker: 'state', json: true, slowMs: 3000 },
  { fn: 'rules', method: 'GET', url: `${SITE}/engine.js`, status: 200, type: 'text/javascript', marker: 'allLegalMoves', slowMs: 2000 },
  { fn: 'game, rules', method: 'GET', url: `${SITE}/health`, status: 200, type: 'application/health+json', marker: 'status', json: true, slowMs: 3000 },
];

export const NOT_TESTED = [
  {
    zh: '走棋、悔棋、和棋、认输和开始新局——它们会改动大家正在下的那盘棋。',
    en: 'Playing a move, undo, draw, resign and new game — they would change the game people are playing.',
    detail: 'Moving, undo, draw, resign and new game: they change the one game everybody shares, so tests never submit an action. The rules and saving are covered by the unit and API tests in the repository.',
  },
  {
    zh: '两台设备之间同步走棋——这需要真的走一步棋。',
    en: 'Moves syncing between two devices — that needs a real move.',
    detail: 'Syncing between two devices and conflict handling: these need writes and are covered by tests/client-sync.test.js.',
  },
  {
    zh: '只在你的浏览器里发生的事：落点提示、全屏、键盘操作和语言切换。',
    en: 'Things that happen only in your browser: move hints, full screen, the keyboard and the language switch.',
    detail: 'Browser-only features: legal-point hints, full screen, keyboard play, the language switch and local settings.',
  },
];

export const HEALTH_EXAMPLE = `{
  "status": "pass",
  "time": "2026-11-03T23:00:00Z",
  "functions": [
    { "key": "game", "name": "Shared game storage", "status": "pass" },
    { "key": "rules", "name": "Move rules", "status": "pass" }
  ]
}`;
