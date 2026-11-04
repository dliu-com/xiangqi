// The Health tab (/docs#health) of the docs page, for people: numbers, a tier diagram in the same style and colours as the
// Architecture tab, the outcomes, a plain-words table and a chart.
// No exact technical facts here (status codes, headers, formats); those are in /docs/health.md, for machines.
import { t } from './i18n.js';
import { flow, tiers, stats, table, callout } from './diagram.js';
import { FUNCTIONS, CHECKS, NOT_TESTED, PLACES } from './health-checks.js';

const NAMES = { pages: ['页面', 'Pages'], docs: ['文档', 'Docs'], game: ['共享棋局', 'Shared game'], rules: ['行棋规则', 'Move rules'] };
const checksFor = key => CHECKS.filter(check => check.fn.split(', ').includes(key)).length;

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
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  return ul;
}

// A horizontal bar chart: [label, value] rows, bars scaled to the largest value.
function barChart(title, rows, note) {
  const figure = document.createElement('figure');
  figure.className = 'dg health-chart';
  const caption = document.createElement('figcaption');
  caption.textContent = title;
  figure.append(caption);
  const max = Math.max(...rows.map(([, value]) => value));
  const body = document.createElement('div');
  body.className = 'health-chart-rows';
  body.setAttribute('role', 'list');
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'health-chart-row';
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', `${label}: ${value}`);
    const name = document.createElement('span');
    name.textContent = label;
    const track = document.createElement('span');
    track.className = 'health-chart-track';
    const bar = document.createElement('span');
    bar.className = 'health-chart-bar';
    bar.style.width = `${(value / max) * 100}%`;
    track.append(bar);
    const number = document.createElement('span');
    number.className = 'health-chart-value';
    number.textContent = String(value);
    row.append(name, track, number);
    body.append(row);
  }
  figure.append(body);
  if (note) {
    const p = document.createElement('p');
    p.className = 'dg-note';
    p.textContent = note;
    figure.append(p);
  }
  return figure;
}

const MARKS = {
  pass: () => ({ text: t('✓ 正常', '✓ Working'), className: 'status' }),
  warn: () => ({ text: t('变慢', 'Slow'), className: 'risk-medium' }),
  fail: () => ({ text: t('✗ 故障', '✗ Not working'), className: 'risk-high' }),
  unknown: () => ({ text: t('未知', 'Unknown'), className: '' }),
  checking: () => ({ text: t('检查中…', 'Checking…'), className: '' }),
};

// Fills the "Now" column: you are reading this page, so pages and docs work; the site's own self-check says the rest.
async function showLiveStatus(rows) {
  const set = (key, mark) => { const cell = rows.get(key); if (cell) { const { text, className } = MARKS[mark](); cell.textContent = text; cell.className = className; } };
  set('pages', 'pass'); set('docs', 'pass');
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    const report = await response.json();
    for (const fn of report.functions || []) set(fn.key, MARKS[fn.status] ? fn.status : 'unknown');
  } catch {
    set('game', 'unknown'); set('rules', 'unknown');
  }
}

function markdownLink(text) {
  const p = document.createElement('p');
  const link = document.createElement('a');
  link.href = '/docs/health.md';
  link.textContent = text;
  p.append(link);
  return p;
}

export function health(root) {
  const add = writer(root);
  const top = markdownLink(t('给机器读的版本：/docs/health.md', 'Machine-readable version: /docs/health.md'));
  top.className = 'dg-note';
  root.append(top);
  const places = PLACES.map(place => t(...place)).join(t('、', ', '));
  const schedule = t(`${PLACES.slice(0, 3).map(place => place[0]).join('、')}每 15 分钟一次；中国每小时一次`, `${PLACES.slice(0, 3).map(place => place[1]).join(', ')} every 15 min; China hourly`);

  add('p', t('status.dliu.com 每 15 分钟像普通访客一样来看看本网站：不登录，只看不动，从不走棋，所以不会打扰正在下的棋。',
    'Every 15 minutes, status.dliu.com looks at this site the way any visitor would: no sign-in, looking only, never playing a move, so games in progress are never disturbed.'), 'lead');

  root.append(stats([
    [String(FUNCTIONS.length), t('项功能被测试', 'functions tested'), 'board'],
    [String(CHECKS.length), t('项检查', 'checks each time'), 'filter'],
    [t('每 15 分钟', 'Every 15 min'), t('全天候', 'day and night'), 'clock'],
    [t(`从 ${PLACES.length} 个地方`, `From ${PLACES.length} places`), schedule, 'route53'],
    ['0', t('次登录', 'sign-ins needed'), 'lock'],
    ['0', t('步棋被走动', 'moves played'), 'shield'],
  ]));

  root.append(tiers({
    title: t('如何测试本网站', 'How this site is tested'),
    rows: [
      {
        label: t('测试者', 'Testers'), badge: t('访客', 'Guest'), tone: 'untrusted',
        nodes: [
          { icon: 'bot', title: 'status.dliu.com', text: schedule },
        ],
      },
      {
        label: 'CloudFront', badge: t('边缘', 'Edge'), tone: 'edge', link: t('HTTPS，不登录', 'HTTPS, no sign-in'),
        nodes: [
          { icon: 'page', title: t('页面和文档', 'Pages and docs'), text: t('首页（棋盘）、脚本、样式和文档', 'the home page (board), scripts, styles and docs') },
          { icon: 'cloudfront', title: '/api/game', text: t('读取当前棋局，从不走棋', 'reads the current game, never plays a move') },
          { icon: 'shield', title: '/health', text: t('请网站自己检查一遍，每分钟最多一次', 'asks the site to check itself, at most once a minute') },
        ],
      },
      {
        label: 'Lambda', badge: 'API', tone: 'app', link: t('由 CloudFront 签名', 'signed by CloudFront'),
        nodes: [
          { icon: 'lambda', title: t('自检', 'Self-check'), text: t('检查数据库和规则，只读', 'checks the database and the rules, read only') },
          { icon: 'filter', title: t('规则检查', 'Rule check'), text: t('必须算出红方开局的 44 种走法', 'must find Red’s 44 opening moves') },
        ],
      },
      {
        label: t('AWS 账户', 'AWS account'), badge: t('私有', 'Private'), tone: 'private', link: t('只读一次，从不写入', 'one read, never a write'),
        nodes: [
          { icon: 'dynamodb', title: 'DynamoDB', text: t('读取一次棋局', 'one read of the game') },
          { icon: 's3', title: 'S3', text: t('网页文件，经 CloudFront 读取', 'the page files, read through CloudFront') },
        ],
      },
    ],
    note: t('每项功能得到绿、黄或红：连续两次失败才算故障。', 'Each function ends up green, amber or red; it only counts as down after two failed runs in a row.'),
  }));

  const outcomes = flow({
    title: t('三种结果', 'Three outcomes'),
    steps: [
      { icon: 'power', title: t('正常', 'Working'), text: t('一切照常，可以下棋', 'all fine, go ahead and play'), tone: 'good' },
      { icon: 'clock', title: t('变慢', 'Slow'), text: t('还能用，只是要多等一会儿', 'still works, just takes longer'), tone: 'warn' },
      { icon: 'lock', title: t('故障', 'Not working'), text: t('有功能出问题了，连续两次才算', 'something is broken, counted after two runs in a row'), tone: 'bad' },
    ],
  });
  // The three outcomes are alternatives, not steps.
  for (const arrow of outcomes.querySelectorAll('.dg-arrow')) arrow.remove();
  root.append(outcomes);

  add('h2', t('每项功能', 'Each function'));
  const tableNode = table(
    [t('功能', 'Function'), t('为你做什么', 'What it does for you'), t('怎么测试', 'How it’s tested'), t('如果坏了，你会看到', 'If it broke, you would notice'), t('现在', 'Now')],
    FUNCTIONS.map(fn => [t(...NAMES[fn.key]), t(fn.whatZh, fn.whatEn), t(fn.howZh, fn.howEn), t(fn.downZh, fn.downEn), { ...MARKS.checking() }]),
  );
  const rows = new Map();
  tableNode.querySelectorAll('tbody tr').forEach((tr, index) => rows.set(FUNCTIONS[index].key, tr.lastElementChild));
  root.append(tableNode);
  void showLiveStatus(rows);

  root.append(barChart(t('每项功能的检查次数', 'Checks per function'),
    FUNCTIONS.map(fn => [t(...NAMES[fn.key]), checksFor(fn.key)]),
    t('/health 同时检查“共享棋局”和“行棋规则”，所以计入两项。', '/health checks both the shared game and the move rules, so it counts for both.')));

  add('h2', t('不测试什么', 'What isn’t tested'));
  root.append(list(NOT_TESTED.map(item => t(item.zh, item.en))));
  root.append(callout('shield', t('本网站没有登录，所以测试看到的就是任何访客看到的。规则和保存另由代码库里的自动测试检查。',
    'The site has no sign-in, so the tests see exactly what any visitor sees. The rules and saving are also checked by automated tests in the code.')));

  root.append(markdownLink(t('给机器读的技术版本（Markdown）', 'Technical version for machines (Markdown)')));
}
