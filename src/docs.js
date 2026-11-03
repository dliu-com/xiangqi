import { t, LANGUAGE_EVENT } from './i18n.js';
import { flow, tiers, stats, table, callout, more } from './diagram.js';

const TABS = ['architecture', 'cost', 'security'];
const TITLES = { architecture: ['技术架构', 'Technical architecture'], cost: ['运行成本', 'Cost'], security: ['安全', 'Security'] };
const num = text => ({ text, className: 'num' });
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
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  return ul;
}

// ---------------------------------------------------------------- Technical architecture
function architecture(root) {
  const add = writer(root);
  add('p', t(
    'xiangqi.dliu.com 是一盘所有人共享的中国象棋棋局。这里没有服务器：网页文件存放在 S3，由 CloudFront 分发；只有读取或保存棋局时，才会运行一个小小的 Lambda 函数。整盘棋保存在 DynamoDB 的一条记录中。',
    'xiangqi.dliu.com is one shared game of Xiangqi (Chinese chess). There are no servers: the page files sit in S3 and CloudFront delivers them; a small Lambda function runs only when the page reads or saves the game. The whole game is one item in DynamoDB.'), 'lead');

  root.append(stats([
    [t('0 台服务器', '0 servers'), t('没人下棋时，什么都不运行', 'nothing runs while nobody is playing'), 'power'],
    ['1 Lambda', t('检查规则并保存棋局', 'checks the rules and saves the game'), 'lambda'],
    [t('1 条记录', '1 item'), t('DynamoDB 中的整盘棋', 'the whole game, in DynamoDB'), 'dynamodb'],
    ['1 CloudFront', t('分发网页和 /api/game', 'serves the pages and /api/game'), 'cloudfront'],
  ]));

  root.append(tiers({
    title: t('组成部分', 'Components'),
    rows: [
      {
        label: t('玩家', 'Players'), badge: t('浏览器', 'Browser'), tone: 'untrusted',
        nodes: [
          { icon: 'board', title: t('棋盘页面', 'Board page'), text: t('index.html、app.js 和 engine.js：画出棋盘，并在本地标出合法落点', 'index.html, app.js and engine.js draw the board and mark legal points locally') },
          { icon: 'eye', title: t('本地设置', 'Local settings'), text: t('对弈方式、执棋方、上下方向和语言只存在本浏览器（localStorage）', 'Play mode, side, orientation and language stay in this browser (localStorage)') },
        ],
      },
      {
        label: 'CloudFront', badge: t('边缘', 'Edge'), tone: 'edge', link: t('仅 HTTPS（HTTP/2、HTTP/3）', 'HTTPS only (HTTP/2, HTTP/3)'),
        nodes: [
          { icon: 'page', title: t('静态文件', 'Static files'), text: t('通过源访问控制（OAC）从私有 S3 存储桶读取', 'Read from the private S3 bucket with Origin Access Control (OAC)') },
          { icon: 'cloudfront', title: '/api/game', text: t('不缓存，转发到 Lambda 函数 URL，并由 CloudFront 签名', 'Never cached; forwarded to the Lambda function URL and signed by CloudFront') },
          { icon: 'shield', title: t('安全响应头', 'Security headers'), text: t('CSP、HSTS、禁止嵌入框架、nosniff、权限策略', 'CSP, HSTS, no framing, nosniff, Permissions-Policy') },
        ],
      },
      {
        label: 'Lambda', badge: 'API', tone: 'app', link: t('IAM 签名（OAC）', 'IAM-signed (OAC)'),
        nodes: [
          { icon: 'filter', title: t('规则检查', 'Rule check'), text: t('与浏览器完全相同的 engine.js，在保存前重新检查每一个动作', 'The very same engine.js as the browser re-checks every action before saving') },
          { icon: 'lock', title: t('条件写入', 'Conditional write'), text: t('只有版本号未变时才保存，冲突返回 409 和最新棋局', 'Saves only if the revision is unchanged; a conflict returns 409 with the latest game') },
        ],
      },
      {
        label: t('AWS 账户', 'AWS account'), badge: t('私有', 'Private'), tone: 'private', link: t('最小权限角色', 'least-privilege role'),
        nodes: [
          { icon: 'dynamodb', title: 'DynamoDB', text: t('按需计费的表，一条记录 gameId=current', 'On-demand table with one item, gameId=current') },
          { icon: 's3', title: 'S3', text: t('网页文件：禁止公开访问、加密、启用版本控制', 'Page files: public access blocked, encrypted, versioned') },
          { icon: 'route53', title: t('Route 53 与 ACM', 'Route 53 and ACM'), text: t('dliu.com 区域中的 xiangqi 别名记录与免费证书', 'xiangqi alias records in the dliu.com zone, and a free certificate') },
        ],
      },
    ],
    note: t('Lambda 只能读写这一张表；CloudFront 只能读取这个存储桶，也是唯一能调用这个 Lambda 函数 URL 的服务。',
      'The Lambda may only read and write its one table; CloudFront may only read the bucket and is the only caller allowed to invoke the function URL.'),
  }));

  root.append(flow({
    title: t('走一步棋', 'Playing one move'),
    numbered: true,
    steps: [
      { icon: 'board', title: t('选子', 'Choose'), text: t('浏览器用 engine.js 标出合法落点', 'The browser marks legal points with engine.js') },
      { icon: 'eye', title: t('确认', 'Check'), text: t('GET /api/game：若版本已变，刷新棋盘并请玩家重选', 'GET /api/game: if the revision changed, redraw and ask again') },
      { icon: 'upload', title: t('提交', 'Send'), text: t('POST 版本号和动作，附带请求体的 SHA-256', 'POST the revision and the action, with the body’s SHA-256') },
      { icon: 'key', title: t('签名', 'Sign'), text: t('CloudFront 用 SigV4 为请求签名', 'CloudFront signs the request with SigV4') },
      { icon: 'lambda', title: t('验证并保存', 'Validate and save'), text: t('Lambda 重新检查规则，按版本号条件写入', 'Lambda re-checks the rules and writes conditionally on the revision') },
      { icon: 'clock', title: t('同步', 'Sync'), text: t('其他设备每 5 秒读取一次，看到新版本后重画', 'Other devices read every 5 seconds and redraw on a new revision'), tone: 'good' },
    ],
  }));

  add('h2', t('共享棋局与冲突', 'One shared game, and conflicts'));
  root.append(list([
    t('只有一盘棋，没有账户或房间。任何打开网站的人都在下这同一盘棋；刷新页面或换一台设备，都会恢复当前局面、轮到哪方、棋谱和结果。',
      'There is one game, with no accounts or rooms. Everyone who opens the site plays the same game; refreshing or switching devices restores the position, the side to move, the moves and the result.'),
    t('页面打开时每 5 秒读取一次棋局，在载入、重新聚焦、恢复可见、重新联网或点击“重试”时也会立即读取。正在读取或保存时，不会再发起读取。',
      'While the page is open it reads the game every 5 seconds, and at once on load, focus, becoming visible, reconnecting or Retry. No read starts while another read or a save is running.'),
    t('每次落子前，浏览器先读取最新棋局。若版本号已变，就不发送这步棋，而是请玩家根据最新局面重新选择。',
      'Before each move the browser reads the latest game. If the revision has changed it does not send the move, and asks the player to choose again.'),
    t('保存时，DynamoDB 只在版本号仍是浏览器所见的版本时才写入。两台设备同时落子时，后到的一方会收到 409 和最新棋局，不会覆盖对方的棋。',
      'When saving, DynamoDB writes only if the revision is still the one the browser saw. If two devices move at once, the later one gets 409 and the latest game instead of overwriting.'),
    t('只有保存成功后，落子才算完成。如果不确定是否保存成功（例如网络中断），页面会重新读取棋局再继续。',
      'A move counts only once it is saved. If it is unclear whether a save worked (for example, the connection dropped), the page reads the game again before continuing.'),
    t('“2 人不同设备”中的执棋方只是本地的输入设置，不是经过验证的座位。',
      'The side chosen under “2 players, two devices” is a local input setting, not an authenticated seat.'),
  ]));

  add('h2', t('缓存', 'Caching'));
  root.append(table([t('内容', 'What'), t('缓存方式', 'Cached'), t('原因', 'Why')], [
    [mono('app.js, engine.js, i18n.js, docs.js, diagram.js, agent-tools.js, styles.css, favicon.svg'), t('边缘最多 1 天，浏览器 5 分钟', 'Up to 1 day at the edge, 5 minutes in browsers'), t('每次发布都会使 /* 失效，所以不会过时', 'Every publish invalidates /*, so nothing goes stale')],
    [mono('index.html, docs, 404.html'), t('每次都重新验证', 'Always revalidated'), t('新版本发布后立即生效', 'A new release shows at once')],
    [mono('/api/game'), t('从不缓存（no-store）', 'Never cached (no-store)'), t('棋局存放在 DynamoDB，每次读取都是最新的', 'The game lives in DynamoDB; every read is current')],
    [mono('dl.css, dl-docs.css'), t('由 files.dliu.com 提供', 'Served by files.dliu.com'), t('所有 dliu.com 网站共用的外观', 'The look shared by every dliu.com site')],
  ]));

  add('h2', t('语言', 'Languages'));
  add('p', t('网站默认使用中文。页眉右侧可切换为 English，选择保存在本浏览器中（localStorage 的 xiangqi-language），以后访问也会沿用。棋子和“楚河 汉界”始终是汉字。',
    'The site is in Chinese by default. The switch at the right of the header changes it to English; the choice is saved in this browser (xiangqi-language in localStorage) and kept on later visits. Pieces and the river label are always shown in Chinese characters.'));

  add('h2', t('代码与部署', 'Code and deployment'));
  root.append(list([
    t('src/：HTML、CSS 和浏览器 JavaScript，直接上传到 S3，不需要构建，也没有第三方脚本。',
      'src/: HTML, CSS and browser JavaScript, uploaded to S3 as they are, with no build step and no third-party scripts.'),
    t('backend/：Lambda 处理程序与权威的棋局逻辑。CDK 把 src/engine.js、backend/game-service.js 和 backend/handler.cjs 拼成一个没有依赖的内联函数。',
      'backend/: the Lambda handler and the authoritative game logic. CDK joins src/engine.js, backend/game-service.js and backend/handler.cjs into one dependency-free inline function.'),
    t('cdk/：XiangqiSite 堆栈（eu-west-1），包含 S3、CloudFront、DynamoDB、Lambda、证书和 DNS 记录。',
      'cdk/: the XiangqiSite stack (eu-west-1) with S3, CloudFront, DynamoDB, Lambda, the certificate and the DNS records.'),
    t('make deploy 先运行测试（规则、API、共享外观和基础设施），再部署堆栈、上传文件，并等待 CloudFront 失效完成。GitHub Actions 和 Jenkins 使用同样的步骤。',
      'make deploy runs the tests (rules, API, shared look and infrastructure), deploys the stack, uploads the files and waits for the CloudFront invalidation. GitHub Actions and Jenkins run the same steps.'),
    t('访问量由中央流量监控（traffic.dliu.com）根据 CloudFront 日志统计；本网站不运行任何统计脚本。',
      'Visits are counted by the central traffic monitor (traffic.dliu.com) from CloudFront’s logs; this site runs no analytics script.'),
  ]));
  add('p', t('源代码：dliu-com/xiangqi（cdk/lib/xiangqi-site-stack.ts、backend/、src/）。', 'Source: dliu-com/xiangqi (cdk/lib/xiangqi-site-stack.ts, backend/, src/).'), 'source');
}

// ---------------------------------------------------------------- Cost
function cost(root) {
  const add = writer(root);
  add('p', t('一切按用量计费。没人下棋时，只需为存储几十 KB 的网页文件和一条棋局记录付费，每月不到 1 美分。',
    'Everything is billed per use. With nobody playing, the only charge is storing a few dozen KB of page files and one game item: less than a cent a month.'), 'lead');

  root.append(stats([
    ['$0', t('固定月费', 'fixed monthly fee'), 'budget'],
    ['≈ $0.0013', t('超出免费额度后，每个打开的页面每小时', 'per open page per hour, beyond the free tiers'), 'clock'],
    ['≈ 3,000', t('过去 30 天的 API 调用：全部在免费额度内', 'API calls in the last 30 days: all inside the free tiers'), 'lambda'],
    ['< $0.01', t('每月存储', 'storage per month'), 's3'],
  ]));

  add('h2', t('各部分费用', 'What each part costs'));
  add('p', t('以下为 eu-west-1（爱尔兰）的标价。免费额度按 AWS 账户计算，由所有 dliu.com 网站共享。',
    'List prices for eu-west-1 (Ireland). Free tiers are per AWS account, so they are shared with the other dliu.com sites.'));
  root.append(table([t('部分', 'Part'), t('计费方式', 'How it is billed'), t('空闲月份', 'Idle month')], [
    ['CloudFront', t('每月免费：1 TB 流量、1000 万次请求。超出后，欧洲和北美每 GB $0.085，每 1 万次 HTTPS 请求约 $0.012', 'Free each month: 1 TB out and 10 million requests. Then $0.085 per GB (Europe and North America) and about $0.012 per 10,000 HTTPS requests'), num('$0')],
    [t('CloudFront 函数', 'CloudFront Functions'), t('流量监控的访客函数：每月免费 200 万次，之后每百万次 $0.10', 'The traffic monitor’s visitor function: 2 million runs free a month, then $0.10 per million'), num('$0')],
    ['Lambda', t('每百万次调用 $0.20，每 GB 秒 $0.0000166667（x86，256 MB）。平均 10 毫秒，约合每百万次 $0.24。每月免费 100 万次调用和 40 万 GB 秒', '$0.20 per million calls and $0.0000166667 per GB-second (x86, 256 MB). At 10 ms on average that is about $0.24 per million calls. Free each month: 1 million calls and 400,000 GB-seconds'), num('$0')],
    [t('DynamoDB（按需）', 'DynamoDB (on demand)'), t('每百万读取单位 $0.1415（强一致读取每 4 KB 一个单位），每百万写入单位 $0.705（每 1 KB 一个单位）。新局约 2 KB，100 步的棋局约 11 KB。存储每 GB 每月 $0.283，每个账户前 25 GB 免费', '$0.1415 per million read units (one per 4 KB, strongly consistent) and $0.705 per million write units (one per 1 KB). A new game is about 2 KB, a 100-move game about 11 KB. Storage $0.283 per GB-month; the first 25 GB per account are free'), num('$0')],
    ['S3', t('约 80 KB 的网页文件（含旧版本），S3 标准存储每 GB 每月 $0.023；只有缓存未命中时才读取', 'About 80 KB of page files (old versions included) in S3 Standard at $0.023 per GB-month; read only on cache misses'), num('< $0.01')],
    ['CloudWatch Logs', t('Lambda 日志保留一周，每 GB $0.57；每次调用约 350 字节，约合每百万次 $0.20', 'Lambda logs kept one week at $0.57 per GB; about 350 bytes per call, roughly $0.20 per million calls'), num('$0')],
    [t('证书（ACM）与 DNS', 'Certificate (ACM) and DNS'), t('公共证书免费；指向 CloudFront 的别名记录在现有 dliu.com 区域中免费应答', 'Public certificates are free; alias records to CloudFront answer free in the existing dliu.com zone'), num('$0')],
    [t('预留并发', 'Reserved concurrency'), t('Lambda 最多同时运行 10 个，不另收费', 'At most 10 Lambda runs at once; no extra charge'), num('$0')],
    [t('流量日志', 'Traffic logs'), t('计入流量监控：每 GB 日志 $0.25', 'Billed to the traffic monitor: $0.25 per GB of log lines'), num('< $0.01')],
  ]));
  root.append(callout('power', t('没有 EC2、容器、负载均衡器、NAT 网关、API Gateway 或 WAF，也没有预置容量、时间点恢复或保活计划，所以没有任何东西会因为“存在”而产生费用。',
    'There is no EC2, container, load balancer, NAT gateway, API Gateway or WAF, and no provisioned capacity, point-in-time recovery or keep-alive schedule, so nothing costs money just by existing.')));

  add('h2', t('示例', 'Examples'));
  root.append(table([t('情形', 'Situation'), t('估算（超出免费额度后）', 'Estimate (beyond the free tiers)')], [
    [t('一个月没人下棋', 'A month with nobody playing'), num(t('< $0.01 / 月', '< $0.01 / month'))],
    [t('一个页面打开 1 小时（720 次读取）', 'One page open for an hour (720 reads)'), num('≈ $0.0013')],
    [t('两台设备下一盘 100 步、1 小时的棋', 'A 100-move, one-hour game on two devices'), num('≈ $0.003')],
    [t('过去 30 天的实际用量（约 3,000 次 API 调用）', 'The actual last 30 days (about 3,000 API calls)'), num(t('$0（在免费额度内）', '$0 (inside the free tiers)'))],
  ]));
  add('p', t('每次读取的费用：CloudFront 请求约 $0.0000012，Lambda 约 $0.00000024，DynamoDB 约 $0.00000014，日志约 $0.0000002。读取间隔为 5 秒，所以关掉或隐藏页面就不会再产生费用；浏览器也会放慢后台标签页的计时器。价格核对于 2026 年 11 月。',
    'Per read: about $0.0000012 for the CloudFront request, $0.00000024 for Lambda, $0.00000014 for DynamoDB and $0.0000002 for logs. Reads come every 5 seconds, so closing the page stops the cost; browsers also slow timers in background tabs. Prices checked in November 2026.'), 'dg-note');
  add('p', t('源代码：dliu-com/xiangqi（cdk/lib/xiangqi-site-stack.ts）。', 'Source: dliu-com/xiangqi (cdk/lib/xiangqi-site-stack.ts).'), 'source');
}

// ---------------------------------------------------------------- Security
function security(root) {
  const add = writer(root);
  const PASS = { text: t('✓ 通过', '✓ Pass'), className: 'status' };
  const FIXED = { text: t('✓ 已修复', '✓ Fixed'), className: 'status fixed' };
  const NOTE = { text: t('已接受', 'Accepted'), className: 'risk-medium' };
  const LOW = { text: t('低', 'Low'), className: 'risk-low' };
  const MEDIUM = { text: t('中', 'Medium'), className: 'risk-medium' };

  add('p', t('任何人都可以下这盘共享的棋，所以要保护的不是“谁能下”，而是：只能走合法的棋、不能绕过 CloudFront、不能注入脚本，以及不能让费用失控。',
    'Anyone may play the shared game, so the job is not to decide who may play, but to make sure that only legal moves are saved, nothing bypasses CloudFront, no script can be injected, and the bill cannot run away.'), 'lead');
  root.append(callout('shield', t('2026 年 11 月 3 日完成威胁建模，并对线上网站进行了渗透测试。测试发现的问题均已修复并重新测试，见下表中的“已修复”。',
    'Threat-modelled and penetration-tested against the live site on 3 November 2026. Everything the tests found was fixed and tested again; see “Fixed” below.')));

  root.append(tiers({
    title: t('信任边界', 'Trust boundaries'),
    rows: [
      {
        label: t('任何人', 'Anyone'), badge: t('不可信', 'Untrusted'), tone: 'untrusted',
        nodes: [
          { icon: 'users', title: t('玩家', 'Players'), text: t('可以读取棋局，并走棋、悔棋、和棋、认输或开始新局', 'Can read the game and move, undo, agree a draw, resign or start a new game') },
          { icon: 'bot', title: t('攻击者', 'Attackers'), text: t('可以直接调用 xiangqi.dliu.com、/api/game，以及 Lambda 函数 URL、S3 等 AWS 端点', 'Can call xiangqi.dliu.com, /api/game, and AWS endpoints such as the function URL and S3 directly') },
        ],
      },
      {
        label: 'CloudFront', badge: t('边缘', 'Edge'), tone: 'edge', link: t('仅 HTTPS', 'HTTPS only'),
        nodes: [
          { icon: 'cloudfront', title: t('分发', 'Distribution'), text: t('TLS 1.2+；页面只允许 GET 和 HEAD；只有 /api/game 能到达 Lambda', 'TLS 1.2+; pages allow only GET and HEAD; only /api/game reaches Lambda') },
          { icon: 'shield', title: t('响应头', 'Headers'), text: t('严格的 CSP、HSTS、禁止嵌入框架、nosniff、权限策略，并去掉 S3 的服务器信息', 'Strict CSP, HSTS, no framing, nosniff, Permissions-Policy, and S3 server details removed') },
        ],
      },
      {
        label: 'Lambda', badge: 'API', tone: 'app', link: t('由 CloudFront 签名（IAM、OAC）', 'signed by CloudFront (IAM, OAC)'),
        nodes: [
          { icon: 'filter', title: t('输入检查', 'Input checks'), text: t('2 KB 上限、仅 JSON、来源必须是本站、版本号与落点必须是整数、每步棋都重新检查规则', '2 KB limit, JSON only, Origin must be this site, integer revisions and points, every move re-checked') },
          { icon: 'lock', title: t('条件写入', 'Conditional write'), text: t('按版本号写入，不会丢失并发更新；最多同时运行 10 个', 'Writes on the revision, so concurrent updates are never lost; at most 10 runs at once') },
        ],
      },
      {
        label: t('AWS 账户', 'AWS account'), badge: t('私有', 'Private'), tone: 'private', link: t('最小权限角色', 'least-privilege role'),
        nodes: [
          { icon: 'dynamodb', title: 'DynamoDB', text: t('Lambda 只能对这一张表执行 GetItem 和 PutItem；加密存储', 'Lambda may only GetItem and PutItem on its one table; encrypted at rest') },
          { icon: 's3', title: 'S3', text: t('禁止所有公开访问、加密、仅 HTTPS；只有这个 CloudFront 分发能读取', 'All public access blocked, encrypted, HTTPS only; only this distribution may read') },
        ],
      },
    ],
    note: t('没有账户、密码、密钥或个人数据：棋局本身就是公开的。浏览器从不接触 AWS 凭证。',
      'There are no accounts, passwords, keys or personal data: the game itself is public. The browser never holds AWS credentials.'),
  }));

  add('h2', t('限制', 'Limits'));
  root.append(stats([
    ['2 KB', t('每个请求的最大大小', 'largest request'), 'filter'],
    [t('2,000 步', '2,000 moves'), t('每盘棋最多记录，远低于 DynamoDB 的 400 KB 上限', 'kept per game, well inside DynamoDB’s 400 KB item limit'), 'dynamodb'],
    ['10', t('Lambda 最多同时运行数', 'Lambda runs at once, at most'), 'lambda'],
    [t('20 秒', '20 s'), t('Lambda 超时', 'Lambda timeout'), 'clock'],
  ]));

  add('h2', t('线上渗透测试', 'Live penetration test'));
  add('p', t('以下测试均使用 curl、openssl 和 AWS CLI 针对 https://xiangqi.dliu.com 运行。为了不影响正在进行的棋局，写入测试只使用过期的版本号或不合法的走法，测试前后棋局版本号相同。',
    'Each test was run against https://xiangqi.dliu.com with curl, openssl and the AWS CLI. To leave the game in progress untouched, write tests used only stale revisions or illegal moves; the game’s revision was the same before and after.'));
  root.append(table([t('测试', 'Test'), t('结果', 'Result'), t('状态', 'Status')], [
    [t('HTTP 降级', 'HTTP downgrade'), t('http:// 返回 301 跳转到 https://；HSTS 一年', 'http:// answers 301 to https://; HSTS for one year'), PASS],
    [t('旧版 TLS', 'Old TLS versions'), t('拒绝 TLS 1.0 和 1.1，只接受 1.2 和 1.3', 'TLS 1.0 and 1.1 refused; only 1.2 and 1.3 accepted'), PASS],
    [t('内容安全策略（CSP）', 'Content-Security-Policy'), t('原来没有 CSP 和权限策略。现在脚本只能来自本站（不允许内联），样式和图片只能来自本站和共享的 dliu.com 文件夹，禁止插件、表单提交和嵌入框架', 'There was no CSP or Permissions-Policy. Now scripts come only from the site itself (no inline code), styles and images only from the site and the shared dliu.com folder, and plugins, form posts and framing are blocked'), FIXED],
    [t('API 响应头', 'API response headers'), t('原来 /api/game 的响应没有 HSTS、禁止嵌入框架等响应头。现在与页面使用同一套安全响应头', '/api/game responses had no HSTS, framing or referrer headers. They now get the same security headers as the pages'), FIXED],
    [t('服务器信息泄露', 'Server fingerprinting'), t('原来页面会返回 server: AmazonS3、x-amz-version-id 和 x-amz-server-side-encryption。现在 CloudFront 会去掉这些响应头，只显示 server: CloudFront', 'Pages returned server: AmazonS3, x-amz-version-id and x-amz-server-side-encryption. CloudFront now removes them; only server: CloudFront remains'), FIXED],
    [t('隐藏文件', 'Hidden files'), t('/.git/config、/.env、/package.json、/cdk.json、/backend/handler.cjs 和测试文件返回 404；没有目录列表', '/.git/config, /.env, /package.json, /cdk.json, /backend/handler.cjs and test files return 404; no directory listing'), PASS],
    [t('页面上的其他 HTTP 方法', 'Other HTTP methods on pages'), t('POST、PUT、DELETE、PATCH 和 OPTIONS 被 CloudFront 拒绝', 'POST, PUT, DELETE, PATCH and OPTIONS are refused by CloudFront'), PASS],
    [t('API 上的其他方法和路径', 'Other API methods and paths'), t('PUT、DELETE、PATCH 和 OPTIONS 返回 405；/api/、/api/game/、/api/x 和 /api/..%2fgame 返回 404', 'PUT, DELETE, PATCH and OPTIONS return 405; /api/, /api/game/, /api/x and /api/..%2fgame return 404'), PASS],
    [t('绕过 CloudFront', 'Bypassing CloudFront'), t('直接调用 Lambda 函数 URL 返回 403（需要 IAM 签名）；直接读取或列出 S3 存储桶返回 403', 'Calling the Lambda function URL directly returns 403 (IAM signature required); reading or listing the S3 bucket directly returns 403'), PASS],
    [t('篡改请求体', 'Tampered request bodies'), t('缺少或伪造 x-amz-content-sha256 的 POST 无法通过 Lambda 的签名检查', 'POSTs with a missing or wrong x-amz-content-sha256 fail Lambda’s signature check'), PASS],
    [t('跨站写入（CSRF）', 'Cross-site writes (CSRF)'), t('Origin 为 evil.example 或 blog.dliu.com 的 POST 被拒绝（403）；text/plain 返回 415；跨站读取得不到 CORS 响应头', 'POSTs with Origin evil.example or blog.dliu.com are refused (403); text/plain returns 415; cross-site reads get no CORS headers'), PASS],
    [t('畸形输入', 'Malformed input'), t('错误的 JSON 返回 400；超过 2 KB 返回 413；小数、字符串或越界的落点返回 400；版本号 1e308 返回 400；__proto__ 等未知动作返回 400', 'Bad JSON returns 400; over 2 KB returns 413; fractional, text or out-of-range points return 400; revision 1e308 returns 400; unknown actions such as __proto__ return 400'), PASS],
    [t('非法走法与过期版本', 'Illegal moves and stale revisions'), t('服务器用同一个 engine.js 重新检查：非法走法返回 400；过期版本返回 409 和最新棋局，不写入任何内容', 'The server re-checks with the same engine.js: illegal moves return 400; stale revisions return 409 with the latest game and write nothing'), PASS],
    [t('脚本注入', 'Script injection'), t('服务器信息用 textContent 显示。浏览器现在会先检查服务器返回的每个棋子（只接受已知的阵营和棋子类型），再画到棋盘上；CSP 也会阻止内联脚本', 'Server messages are shown with textContent. The browser now checks every piece the server returns (known sides and piece types only) before drawing it, and the CSP blocks inline scripts'), FIXED],
    [t('请求洪水', 'Request floods'), t('原来 Lambda 没有并发上限，可能占用整个账户共享的并发额度。现在最多同时运行 10 个：同时发出 40 个请求时，13 个得到应答，27 个返回 429，其他 dliu.com 网站不受影响。页面会在下一次 5 秒读取时自动重试', 'The Lambda had no concurrency limit and could use up the concurrency shared by the whole account. It now runs at most 10 at once: of 40 simultaneous requests, 13 were answered and 27 got 429, and the other dliu.com sites were unaffected. The page simply retries on its next 5-second read'), FIXED],
    [t('访客 Cookie', 'Visitor cookie'), t('dl_vid（流量监控）带有 Secure、HttpOnly、SameSite=Lax；不含个人信息', 'dl_vid (traffic monitor) is Secure, HttpOnly and SameSite=Lax, and holds no personal data'), PASS],
    [t('CloudFront 默认域名', 'CloudFront default domain'), t('*.cloudfront.net 地址也能打开网站，但从那里发出的写入会因来源不符被拒绝', 'The *.cloudfront.net address also serves the site, but writes from there are refused because of the Origin check'), NOTE],
    [t('公开仓库中的密钥', 'Secrets in the public repo'), t('扫描了完整的 git 历史：没有密钥、访问密钥或账户 ID', 'Full git history scanned: no secrets, access keys or account IDs'), PASS],
    [t('依赖', 'Dependencies'), t('浏览器不加载第三方脚本；Lambda 只使用 Node.js 和运行时自带的 AWS SDK', 'The browser loads no third-party scripts; the Lambda uses only Node.js and the AWS SDK built into the runtime'), PASS],
  ]));

  add('h2', t('威胁模型', 'Threat model'));
  root.append(table([t('场景', 'Scenario'), t('剩余风险', 'Residual risk'), t('防护措施', 'Controls')], [
    [t('有人捣乱：开始新局、悔棋或认输，清掉正在进行的棋局', 'Someone disrupts the game: starts a new one, undoes or resigns'), MEDIUM, t('设计如此：这是一盘没有账户的公开棋局。新局、和棋和认输都需要在对话框中确认；只能执行合法的动作', 'By design: this is a public game without accounts. New game, draw and resign each need confirming in a dialog; only legal actions are accepted')],
    [t('提交非法走法或伪造棋局', 'Illegal moves or a forged position are sent'), LOW, t('Lambda 用与浏览器相同的 engine.js 重新检查每个动作；客户端无法直接写入棋盘', 'Lambda re-checks every action with the same engine.js as the browser; clients can never write the board directly')],
    [t('两台设备同时落子，互相覆盖', 'Two devices move at once and overwrite each other'), LOW, t('DynamoDB 按版本号条件写入；冲突返回 409 和最新棋局', 'DynamoDB writes conditionally on the revision; a conflict returns 409 with the latest game')],
    [t('绕过 CloudFront 直接调用 Lambda 或 S3', 'Lambda or S3 is called without CloudFront'), LOW, t('函数 URL 需要 IAM 签名，只授权给这个分发；存储桶禁止公开访问，只允许这个分发读取', 'The function URL needs an IAM signature, granted only to this distribution; the bucket blocks public access and allows only this distribution to read')],
    [t('其他网站让访客的浏览器修改棋局（CSRF）', 'Another site makes a visitor’s browser change the game (CSRF)'), LOW, t('POST 必须是 application/json（跨站时需要预检，而 API 不响应预检），且 Origin 必须是 https://xiangqi.dliu.com', 'POSTs must be application/json (a preflight cross-site, which the API never grants) and carry Origin https://xiangqi.dliu.com')],
    [t('通过棋局数据注入脚本（XSS）', 'Script injected through game data (XSS)'), LOW, t('棋局只由服务器根据合法走法生成；浏览器再次检查每个棋子；严格的 CSP 禁止内联和第三方脚本', 'The game is built only by the server from legal moves; the browser checks every piece again; a strict CSP blocks inline and third-party scripts')],
    [t('网站被嵌入其他页面进行点击劫持', 'The site is framed for clickjacking'), LOW, t('X-Frame-Options: DENY 和 frame-ancestors \'none\'', 'X-Frame-Options: DENY and frame-ancestors \'none\'')],
    [t('请求在传输中被窃听或篡改', 'Requests are read or changed in transit'), LOW, t('仅 HTTPS、TLS 1.2+、HSTS；CloudFront 到 Lambda 的请求带签名和请求体哈希', 'HTTPS only, TLS 1.2+, HSTS; CloudFront signs requests to Lambda, including the body hash')],
    [t('大量请求推高费用或拖垮其他网站', 'A request flood runs up the bill or starves other sites'), MEDIUM, t('没有固定成本，Lambda 最多同时运行 10 个；没有 WAF 或速率限制，所以洪水期间仍按请求计费，棋局也可能暂时无法访问', 'No fixed costs and at most 10 Lambda runs at once; there is no WAF or rate limit, so a flood is still billed per request and can make the game briefly unavailable')],
    [t('棋局记录过大，无法保存', 'The game record grows too large to save'), LOW, t('请求最大 2 KB，每盘最多 2,000 步，远低于 DynamoDB 400 KB 的上限', 'Requests are at most 2 KB and games at most 2,000 moves, well inside DynamoDB’s 400 KB limit')],
    [t('棋局数据丢失', 'The game is lost'), LOW, t('删除堆栈时会保留表和存储桶；存储桶启用了版本控制。棋局本身没有备份', 'The table and bucket are kept if the stack is deleted, and the bucket is versioned. The game itself has no backup')],
    [t('公开仓库泄露密钥', 'Secrets leak through the public repository'), LOW, t('应用本身没有密钥；部署凭证只存放在 GitHub 仓库密钥和 Jenkins 中；已扫描 git 历史', 'The app has no secrets; deployment credentials live only in GitHub repository secrets and Jenkins; git history scanned')],
    [t('隐私', 'Privacy'), LOW, t('不收集姓名、账户或个人数据；设置和语言只存在本浏览器；访问量由流量监控根据 CloudFront 日志统计', 'No names, accounts or personal data are collected; settings and language stay in this browser; visits are counted by the traffic monitor from CloudFront logs')],
  ]));

  add('h2', t('已接受的剩余风险', 'Accepted residual risks'));
  root.append(list([
    t('任何人都能修改这盘共享的棋，包括开始新局清空当前棋局。没有账户、房间或座位，这是有意的设计；“我是红方/黑方”只是本地设置。',
      'Anyone can change the shared game, including starting a new one that clears it. There are no accounts, rooms or seats by design; “I play Red/Black” is only a local setting.'),
    t('没有 WAF 或速率限制。并发上限保护了其他网站，但洪水期间的请求仍会计费，棋局也可能暂时无法访问。',
      'There is no WAF or rate limit. The concurrency cap protects the other sites, but requests in a flood are still billed and the game may be briefly unavailable.'),
    t('棋局没有备份（未启用时间点恢复）。被清空的棋局无法恢复。',
      'The game has no backup (no point-in-time recovery). A cleared game cannot be restored.'),
    t('被拒绝的 API 请求（403）显示 CloudFront 的 404 页面而不是 JSON 错误，因为整个分发把 S3 的 403 映射为 404。本站页面发出的请求不会遇到这种情况。',
      'Refused API requests (403) show CloudFront’s 404 page rather than a JSON error, because the distribution maps S3’s 403 to 404. Requests from the site’s own pages never meet this.'),
    t('网站也能通过 CloudFront 的默认域名访问；从那里发出的写入会被拒绝。',
      'The site is also reachable at CloudFront’s default domain; writes from there are refused.'),
    t('长将、长捉、重复局面和自然限着不会自动判定，由双方协商。',
      'Perpetual check, perpetual chasing, repetitions and move limits are not adjudicated; the players decide.'),
  ]));

  root.append(more(t('每个页面的响应头', 'Response headers on every page'),
    table([t('响应头', 'Header'), t('值', 'Value')], [
      [mono('Content-Security-Policy'), "default-src 'self'; script-src 'self'; style-src 'self' https://files.dliu.com/dliu.com/ui/; img-src 'self' https://files.dliu.com/dliu.com/; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"],
      [mono('Strict-Transport-Security'), 'max-age=31536000'],
      [mono('X-Frame-Options'), 'DENY'],
      [mono('X-Content-Type-Options'), 'nosniff'],
      [mono('Referrer-Policy'), 'strict-origin-when-cross-origin'],
      [mono('Permissions-Policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
      [mono('Cache-Control'), t('/api/game：no-store', '/api/game: no-store')],
    ])));

  add('p', t('源代码：dliu-com/xiangqi（cdk/lib/xiangqi-site-stack.ts、backend/handler.cjs、backend/game-service.js）。',
    'Source: dliu-com/xiangqi (cdk/lib/xiangqi-site-stack.ts, backend/handler.cjs, backend/game-service.js).'), 'source');
}

const BUILDERS = { architecture, cost, security };

function build() {
  for (const id of TABS) {
    const root = document.getElementById(id);
    // Keep the static, translated heading; rebuild everything after it.
    while (root.lastElementChild && root.lastElementChild !== root.firstElementChild) root.lastElementChild.remove();
    BUILDERS[id](root);
  }
}

function show(scroll) {
  const current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TABS[0];
  for (const id of TABS) document.getElementById(id).hidden = id !== current;
  for (const link of document.querySelectorAll('.dl-tabs a')) {
    if (link.dataset.tab === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${t(...TITLES[current])} · ${t('文档 · 中国象棋', 'Docs · Xiangqi')}`;
  if (scroll) window.scrollTo(0, 0);
}

build();
show(false);
window.addEventListener('hashchange', () => show(true));
window.addEventListener(LANGUAGE_EVENT, () => { build(); show(false); });
