import { t, LANGUAGE_EVENT } from './i18n.js';
import { flow, table, callout, more } from './diagram.js';
import { FUNCTIONS, HEALTH_FUNCTIONS, CHECKS, NOT_TESTED, HEALTH_EXAMPLE } from './health-checks.js';

const mono = text => ({ text, className: 'mono' });

function writer(root) {
  return (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    root.append(node);
    return node;
  };
}

function list(items) {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    if (typeof item === 'string') li.textContent = item;
    else li.append(...item);
    ul.append(li);
  }
  return ul;
}

function code(text) {
  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.textContent = text;
  return pre;
}

function strong(text) {
  const node = document.createElement('strong');
  node.textContent = text;
  return node;
}

function markdownLink() {
  const p = document.createElement('p');
  const link = document.createElement('a');
  link.href = '/docs/health.md';
  link.textContent = t('完整技术版本（Markdown）', 'Full technical version (Markdown)');
  p.append(link, t('：包含所有网址、状态码和格式，足以据此实现测试。', ': every URL, status code and format, enough to implement the tests.'));
  return p;
}

const FUNCTION_NAMES = { pages: ['页面', 'Pages'], docs: ['文档', 'Docs'], game: ['共享棋局', 'Shared game'], rules: ['行棋规则', 'Move rules'] };

function build(root) {
  while (root.lastElementChild && root.lastElementChild !== root.firstElementChild) root.lastElementChild.remove();
  const add = writer(root);

  add('p', t('status.dliu.com 每 15 分钟以普通访客的身份检查一次本网站：不登录，只“看”，从不走棋，所以不会打扰正在下的棋。',
    'Every 15 minutes, status.dliu.com checks this site the way any visitor would: no sign-in, it only looks, and it never plays a move, so games in progress are never disturbed.'), 'lead');

  root.append(flow({
    title: t('如何测试本网站', 'How this site is tested'),
    numbered: true,
    steps: [
      { icon: 'bot', title: 'status.dliu.com', text: t('每 15 分钟一次，以访客身份', 'every 15 minutes, as a guest') },
      { icon: 'page', title: t('打开页面', 'Open the pages'), text: t('棋盘、脚本、样式和文档', 'the board, scripts, styles and docs') },
      { icon: 'board', title: t('读取棋局', 'Read the game'), text: t('只读，从不走棋', 'read only, never a move') },
      { icon: 'shield', title: t('询问 /health', 'Ask /health'), text: t('网站自己检查一遍', 'the site checks itself') },
      { icon: 'dynamodb', title: t('数据库与规则', 'Database and rules'), text: t('读取一次棋局，算一遍开局走法', 'one read of the game, one run of the rules') },
    ],
  }));
  const results = flow({
    title: t('结果', 'Results'),
    steps: [
      { icon: 'power', title: t('正常', 'Pass'), text: t('一切正常', 'everything works'), tone: 'good' },
      { icon: 'clock', title: t('变慢', 'Warn'), text: t('还能用，但响应慢', 'still works, but slowly'), tone: 'warn' },
      { icon: 'lock', title: t('故障', 'Fail'), text: t('某个功能出了问题', 'something is down'), tone: 'bad' },
    ],
    note: t('一次检查失败会立即重试；连续两次失败才算“故障”。', 'A failed check is retried at once; a function is only “down” after two failed runs in a row.'),
  });
  // The three results are alternatives, not steps.
  for (const arrow of results.querySelectorAll('.dg-arrow')) arrow.remove();
  root.append(results);

  add('h2', t('检查什么', 'What is checked'));
  root.append(list(FUNCTIONS.map(fn => [
    strong(t(...FUNCTION_NAMES[fn.key])),
    `${t('：', ': ')}${t(fn.zh, fn.en)}${t('', ' ')}${t('如果故障：', 'If it is down: ')}${t(fn.downZh, fn.downEn)}`,
  ])));

  add('h2', t('不测试什么', 'What isn’t tested'));
  root.append(list(NOT_TESTED.map(item => t(item.zh, item.en))));
  root.append(callout('shield', t('本网站没有登录或受保护的 API，所以测试看到的和任何访客看到的完全一样，不需要任何凭证。',
    'The site has no sign-in or protected API, so the tests see exactly what any visitor sees and need no credentials.')));

  add('h2', t('技术细节', 'Technical details'));
  root.append(markdownLink());
  root.append(more(t('访客检查：网址、方法、状态码和正文标记', 'Guest checks: URLs, methods, status codes and body markers'),
    table([t('功能', 'Function'), t('方法', 'Method'), 'URL', t('状态', 'Status'), t('内容类型', 'Content type'), t('标记或跳转', 'Marker or redirect'), t('慢于', 'Slow after')],
      CHECKS.map(check => [mono(check.fn), check.method, mono(check.url), String(check.status), check.type ? mono(check.type) : '—',
        check.location ? mono(`Location: ${check.location}`) : check.marker ? mono(check.json ? `JSON key "${check.marker}"` : check.marker) : '—',
        check.slowMs ? `${check.slowMs} ms` : '—'])),
    (() => { const p = document.createElement('p'); p.className = 'dg-note'; p.textContent = t('只用 GET 或 HEAD，不带 Cookie。/api/game 从不缓存（no-store）；/health 在 CloudFront 缓存 60 秒。', 'GET or HEAD only, without cookies. /api/game is never cached (no-store); /health is cached for 60 seconds at CloudFront.'); return p; })()));
  root.append(more(t('健康检查端点 /health：响应格式、检查内容和缓存', 'The /health endpoint: response format, checks and caching'),
    table([t('键', 'Key'), t('名称', 'Name'), t('检查内容', 'What it checks'), t('结果', 'Result')],
      HEALTH_FUNCTIONS.map(fn => [mono(fn.key), fn.name, fn.check, fn.result])),
    code(`GET https://xiangqi.dliu.com/health
Content-Type: application/health+json
Cache-Control: public, max-age=60
200 when status is pass or warn, 503 when it is fail

${HEALTH_EXAMPLE}`),
    list([
      t('CloudFront 的 /health 行为不转发 Cookie、Authorization 头或查询字符串，处理程序也不读取请求中的任何内容。', 'CloudFront’s /health behavior forwards no cookies, Authorization header or query string, and the handler reads nothing from the request.'),
      t('只读：不写入、没有副作用、不调用第三方服务；整个响应在 5 秒内返回。', 'Read only: no writes, side effects or third-party calls; the whole response returns within 5 seconds.'),
      t('缓存键不含任何内容，在 CloudFront 缓存 60 秒，所以每个边缘节点每分钟最多运行一次。', 'Keyed on nothing and cached 60 seconds at CloudFront, so it runs at most about once a minute per edge location.'),
      t('不透露私密信息：没有表名、存储桶名、函数名、数量或棋局内容；output 只是 slow、timeout、read failed 之类的通用原因。', 'Reveals nothing private: no table, bucket or function names, counts or game content; output is only a generic reason such as slow, timeout or read failed.'),
    ])));
  root.append(more(t('测试规则', 'Rules for testers'), list([
    t('只发送 GET 或 HEAD，不带 Cookie 或凭证；绝不 POST 到 /api/game。', 'Send only GET or HEAD, without cookies or credentials; never POST to /api/game.'),
    t('用户代理：dliu-status-bot/1.0 (+https://status.dliu.com/docs)，traffic.dliu.com 不会把这些请求计入访问量。', 'User agent: dliu-status-bot/1.0 (+https://status.dliu.com/docs); traffic.dliu.com does not count these requests as visits.'),
    t('在本仓库中可以运行 make guest-check，它会对线上网站执行上面所有的检查。', 'In this repository, make guest-check runs every check above against the live site.'),
  ])));
  add('p', t('源代码：dliu-com/xiangqi（src/health-checks.js、backend/handler.cjs、tests/health.test.js）。',
    'Source: dliu-com/xiangqi (src/health-checks.js, backend/handler.cjs, tests/health.test.js).'), 'source');
}

function render() {
  document.title = `${t('健康检查', 'Health')} · ${t('文档 · DL 中国象棋', 'Docs · DL Xiangqi')}`;
  build(document.getElementById('health'));
}

render();
window.addEventListener(LANGUAGE_EVENT, render);
