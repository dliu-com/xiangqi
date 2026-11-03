import { t, LANGUAGE_EVENT } from './i18n.js';
import { flow, tiers, stats, table, callout, more } from './diagram.js';
import { health } from './docs-health.js';

const TABS = ['architecture', 'cost', 'security', 'health'];
const TITLES = { architecture: ['技术架构', 'Technical architecture'], cost: ['运行成本', 'Cost'], security: ['安全', 'Security'], health: ['测试', 'Testing'] };
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
    ['CloudWatch Logs', t('Lambda 日志保留 3 个月（90 天）：写入每 GB $0.57，存储每 GB 每月 $0.03；每次调用约 350 字节，约合每百万次写入 $0.20、存储每月约 $0.01', 'Lambda logs kept 3 months (90 days): $0.57 per GB written and $0.03 per GB-month stored; about 350 bytes per call, roughly $0.20 per million calls to write and $0.01 a month to store'), num('$0')],
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
const TEST_DATE = '2026-11-03';

function security(root) {
  const add = writer(root);
  const PASS = { text: t('✓ 通过', '✓ Pass'), className: 'status' };
  const FIXED = { text: t('✓ 已修复', '✓ Fixed'), className: 'status fixed' };
  const ACCEPTED = { text: t('已接受', 'Accepted'), className: 'risk-medium' };
  const DECIDE = { text: t('待你决定', 'Your decision'), className: 'risk-medium' };
  const LOW = { text: t('低', 'Low'), className: 'risk-low' };
  const MEDIUM = { text: t('中', 'Medium'), className: 'risk-medium' };
  const INFO = { text: t('提示', 'Info'), className: 'risk-low' };
  const date = num(TEST_DATE);

  add('p', t('任何人都可以下这盘共享的棋，所以要保护的不是“谁能下”，而是：只能保存合法的棋、不能绕过 CloudFront、不能注入脚本、不能读到或改到别的东西，以及费用不能失控。',
    'Anyone may play the shared game, so the job is not to decide who may play, but to make sure that only legal moves are saved, nothing bypasses CloudFront, no script can be injected, nothing else can be read or changed, and the bill cannot run away.'), 'lead');
  root.append(callout('shield', t(`${TEST_DATE} 完成威胁建模、代码审查和三轮线上渗透测试（修复前、修复后、再次加固后）。所有中高风险问题均已修复或由你决定；最新一轮 104 项检查全部通过。任何人都可以用 make security-test 重新运行这些测试，它不会改动棋局。`,
    `Threat-modelled, code-reviewed and penetration-tested against the live site on ${TEST_DATE}, in three rounds (before fixes, after fixes, after further hardening). Every Medium or higher finding is fixed or waiting on your decision; all 104 checks of the latest round passed. Anyone can rerun them with make security-test, which never changes the game.`)));

  add('h2', t('要保护的资产', 'Assets'));
  root.append(list([
    t('棋局的完整性：只有合法的动作才能保存，并发写入不会互相覆盖。', 'The game’s integrity: only legal actions are saved, and concurrent writes never overwrite each other.'),
    t('AWS 账单：没人下棋时接近 0，被滥用时也要有上限。', 'The AWS bill: close to $0 while idle, and bounded under abuse.'),
    t('其他 dliu.com 网站：共享同一个 AWS 账户的 Lambda 并发额度和 dliu.com 的 Cookie 域。', 'The other dliu.com sites: they share this AWS account’s Lambda concurrency and the dliu.com cookie domain.'),
    t('访客：不能被注入脚本、被点击劫持或被追踪个人信息。没有账户、密码或个人数据需要保护。', 'Visitors: no script injection, clickjacking or personal tracking. There are no accounts, passwords or personal data to protect.'),
    t('部署凭证：AWS 访问密钥只在 GitHub 仓库密钥、Jenkins 和管理员的电脑上，应用本身没有任何密钥。', 'Deployment credentials: AWS keys live only in GitHub repository secrets, Jenkins and the owner’s computer; the app itself holds no secrets.'),
  ]));

  add('h2', t('参与者', 'Actors'));
  root.append(table([t('参与者', 'Actor'), t('能做什么', 'What they can do'), t('说明', 'Notes')], [
    [t('匿名访客 / 玩家', 'Anonymous visitor or player'), t('读取棋局；走棋、悔棋、和棋、认输、开始新局', 'Read the game; move, undo, draw, resign, start a new game'), t('这就是全部权限：没有登录，所以也没有“已登录的非所有者”或“所有者”角色', 'That is everything: there is no sign-in, so there is no signed-in non-owner or owner role')],
    [t('带脚本的攻击者', 'Attacker with scripts'), t('直接调用任何 URL 和 AWS 端点，伪造请求头和请求体，大量发送请求', 'Call any URL and AWS endpoint directly, forge headers and bodies, send floods'), t('见渗透测试和“费用滥用”', 'See the penetration test and denial of wallet')],
    [t('其他网站', 'Another website'), t('让访客的浏览器发出请求（CSRF）、嵌入本站（点击劫持）', 'Make a visitor’s browser send requests (CSRF), frame the site (clickjacking)'), t('被 Origin、JSON、CORS 和 frame-ancestors 挡住', 'Stopped by the Origin, JSON, CORS and frame-ancestors checks')],
    [t('被盗的令牌', 'Stolen token'), t('不适用：应用没有会话、令牌或 Cookie 用于授权', 'Not applicable: the app has no sessions, tokens or cookies used for authorisation'), t('唯一的 Cookie dl_vid 是匿名访客 ID，不授予任何权限', 'The only cookie, dl_vid, is an anonymous visitor ID that grants nothing')],
    [t('被攻破的依赖', 'Compromised dependency'), t('浏览器和 Lambda 都不运行第三方包；只有部署工具（CDK、Jest）来自 npm', 'Neither the browser nor the Lambda runs third-party packages; only the build tools (CDK, Jest) come from npm'), t('锁定版本，npm audit 无高危；GitHub Actions 锁定到提交哈希', 'Locked versions, no high npm advisories; GitHub Actions pinned to commit hashes')],
    [t('持有部署凭证的人', 'Holder of deployment credentials'), t('部署任何代码、读写表和存储桶', 'Deploy any code, read and write the table and bucket'), t('在应用之外：由 AWS 账户和 GitHub 仓库的权限保护', 'Outside the app: protected by the AWS account and GitHub repository permissions')],
  ]));

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
          { icon: 'dynamodb', title: 'DynamoDB', text: t('角色只有 4 个权限：对这张表 GetItem、PutItem，对自己的日志组 CreateLogStream、PutLogEvents', 'The role has exactly 4 permissions: GetItem and PutItem on this table, CreateLogStream and PutLogEvents on its own log group') },
          { icon: 's3', title: 'S3', text: t('禁止所有公开访问、加密、仅 HTTPS、禁用 ACL；只有这个 CloudFront 分发能读取', 'All public access blocked, encrypted, HTTPS only, ACLs disabled; only this distribution may read') },
        ],
      },
    ],
    note: t('没有账户、密码、密钥或个人数据：棋局本身就是公开的。浏览器从不接触 AWS 凭证。',
      'There are no accounts, passwords, keys or personal data: the game itself is public. The browser never holds AWS credentials.'),
  }));

  add('h2', t('数据流', 'Data flows'));
  root.append(list([
    t('打开页面：浏览器 → CloudFront（HTTPS）→ S3（OAC 签名）。只有 GET 和 HEAD。', 'Opening a page: browser → CloudFront (HTTPS) → S3 (OAC-signed). GET and HEAD only.'),
    t('读取棋局：浏览器每 5 秒 GET /api/game → CloudFront（不缓存）→ Lambda 函数 URL（SigV4 签名）→ DynamoDB GetItem（强一致）。', 'Reading the game: the browser GETs /api/game every 5 s → CloudFront (no cache) → Lambda function URL (SigV4-signed) → DynamoDB GetItem (strongly consistent).'),
    t('保存动作：浏览器 POST {版本号, 动作} 和请求体 SHA-256 → CloudFront 签名 → Lambda 检查 Origin、类型、大小和规则 → DynamoDB 按版本号条件 PutItem。', 'Saving an action: the browser POSTs {revision, action} with the body’s SHA-256 → CloudFront signs → Lambda checks Origin, type, size and the rules → DynamoDB PutItem, conditional on the revision.'),
    t('设置：对弈方式、执棋方、方向和语言只写入浏览器的 localStorage，从不发送给服务器。', 'Settings: play mode, side, orientation and language are written only to the browser’s localStorage and never sent.'),
    t('部署：管理员的电脑、Jenkins 或 GitHub Actions → CloudFormation、S3 上传和 CloudFront 失效。', 'Deployment: the owner’s computer, Jenkins or GitHub Actions → CloudFormation, S3 upload and CloudFront invalidation.'),
  ]));

  add('h2', t('STRIDE 威胁模型', 'STRIDE threat model'));
  add('p', t('S 冒充、T 篡改、R 抵赖、I 信息泄露、D 拒绝服务、E 权限提升。', 'S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege.'), 'dg-note');
  root.append(table([t('组件', 'Component'), 'STRIDE', t('威胁', 'Threat'), t('防护措施', 'Controls'), t('剩余风险', 'Residual risk')], [
    [t('浏览器页面', 'Browser page'), 'T', t('服务器数据或文本中注入脚本（XSS）', 'Script injected through server data or text (XSS)'), t('只接受已知阵营和棋子类型；消息用 textContent；CSP 禁止内联和第三方脚本', 'Only known sides and piece types accepted; messages via textContent; CSP blocks inline and third-party scripts'), LOW],
    [t('浏览器页面', 'Browser page'), 'S/T', t('其他网站嵌入本站诱导点击', 'Another site frames the page to trick clicks'), t('X-Frame-Options: DENY 和 frame-ancestors \'none\'', 'X-Frame-Options: DENY and frame-ancestors \'none\''), LOW],
    [t('浏览器页面', 'Browser page'), 'I', t('泄露访客数据', 'Visitor data leaks'), t('不收集个人数据；设置只在 localStorage；Referrer-Policy 严格；权限策略禁用摄像头、麦克风、定位等', 'No personal data collected; settings only in localStorage; strict Referrer-Policy; Permissions-Policy blocks camera, microphone, location and more'), LOW],
    ['CloudFront', 'T/I', t('传输中被窃听或篡改', 'Traffic read or changed in transit'), t('仅 HTTPS、TLS 1.2+、HSTS 一年、拒绝弱加密套件', 'HTTPS only, TLS 1.2+, one-year HSTS, weak ciphers refused'), LOW],
    ['CloudFront', 'T', t('缓存投毒或缓存欺骗', 'Cache poisoning or cache deception'), t('缓存键不含任何请求头、Cookie 或查询字符串；S3 不回显请求头；/api/* 从不缓存', 'The cache key has no headers, cookies or query strings; S3 echoes no headers; /api/* is never cached'), LOW],
    ['CloudFront', 'S/E', t('绕过 CloudFront 直接访问源站', 'The origins are reached without CloudFront'), t('函数 URL 需要 IAM 签名，只授权给这个分发；存储桶只允许这个分发读取', 'The function URL needs an IAM signature, granted only to this distribution; only this distribution may read the bucket'), LOW],
    ['CloudFront', 'D', t('请求洪水推高账单', 'A request flood runs up the bill'), t('Lambda 并发上限 10；AWS Shield Standard；没有 WAF', 'Lambda concurrency capped at 10; AWS Shield Standard; no WAF'), MEDIUM],
    [t('Lambda API', 'Lambda API'), 'S', t('其他网站以访客身份写入（CSRF）', 'Another site writes as the visitor (CSRF)'), t('必须 application/json（跨站需预检，API 从不批准）且 Origin 必须是本站', 'application/json required (a cross-site preflight the API never grants), and Origin must be this site'), LOW],
    [t('Lambda API', 'Lambda API'), 'T', t('非法走法、伪造棋局、注入式请求体', 'Illegal moves, forged positions, injection-style bodies'), t('严格类型检查；动作白名单；用 engine.js 重算；客户端从不直接写棋盘', 'Strict type checks; an allowlist of actions; recomputed with engine.js; clients never write the board'), LOW],
    [t('Lambda API', 'Lambda API'), 'T', t('请求体在 CloudFront 和 Lambda 之间被替换', 'The body is swapped between CloudFront and Lambda'), t('SigV4 签名包含请求体 SHA-256', 'The SigV4 signature covers the body’s SHA-256'), LOW],
    [t('Lambda API', 'Lambda API'), 'R', t('无法追溯谁走了哪步棋', 'Who played which move cannot be traced'), t('设计如此：没有账户。CloudFront 访问日志（流量监控）记录 IP 和时间', 'By design, with no accounts. CloudFront access logs (traffic monitor) record IP and time'), ACCEPTED],
    [t('Lambda API', 'Lambda API'), 'I', t('错误信息泄露内部细节', 'Errors reveal internals'), t('意外错误只返回通用消息；日志只记录错误名称和消息，不记录请求', 'Unexpected errors return a generic message; logs keep only the error name and message, never the request'), LOW],
    [t('Lambda API', 'Lambda API'), 'D', t('超大请求或耗时计算', 'Oversized requests or slow computation'), t('2 KB 上限；规则计算有界（90 个点）；20 秒超时；并发上限 10', '2 KB limit; bounded rule computation (90 points); 20 s timeout; concurrency cap 10'), LOW],
    [t('Lambda API', 'Lambda API'), 'E', t('Lambda 被利用后访问其他资源', 'A compromised Lambda reaches other resources'), t('角色只有 4 个权限，资源限定为这张表和这个日志组', 'The role has 4 permissions, limited to this table and this log group'), LOW],
    ['DynamoDB', 'T', t('并发写入互相覆盖', 'Concurrent writes overwrite each other'), t('按版本号条件写入；冲突返回 409', 'Writes conditional on the revision; conflicts return 409'), LOW],
    ['DynamoDB', 'T/D', t('有人开始新局清空棋局，或表被删除', 'Someone starts a new game and clears it, or the table is deleted'), t('新局需要确认；表启用删除保护且删除堆栈时保留；没有备份', 'New game needs confirming; the table has deletion protection and is kept if the stack is deleted; there is no backup'), MEDIUM],
    ['S3', 'T/I', t('网页文件被篡改或泄露未发布的文件', 'Page files tampered with or unpublished files exposed'), t('只有部署凭证能写入；只有 CloudFront 能读；启用版本控制；仓库中的源码和测试不会上传', 'Only deployment credentials can write; only CloudFront can read; versioned; source and tests are never uploaded'), LOW],
    [t('部署流水线', 'Deployment pipeline'), 'T/E', t('被篡改的 Action 或 npm 包', 'A tampered Action or npm package'), t('Actions 锁定到提交哈希；package-lock；部署前运行全部测试', 'Actions pinned to commit hashes; package-lock; all tests run before deploying'), LOW],
    [t('部署流水线', 'Deployment pipeline'), 'S', t('长期 AWS 访问密钥泄露', 'Long-lived AWS access keys leak'), t('存放在 GitHub 密钥和 Jenkins 中；可改用 GitHub OIDC 角色', 'Kept in GitHub secrets and Jenkins; GitHub OIDC roles would remove them'), DECIDE],
  ]));

  add('h2', t('费用滥用（拒绝钱包）', 'Denial of wallet'));
  add('p', t('最坏情况：攻击者以最快速度调用 /api/game。Lambda 每次计费 5 到 7 毫秒，并发上限 10，所以每秒最多约 1,700 次调用；每次都假设读取和写入一盘 11 KB 的棋局（条件写入即使失败也会计费）。这是保守的上限：攻击者要不断拿到最新版本号，才能让请求真正写入。被限流（429）的请求不运行 Lambda，只产生 CloudFront 请求费用。',
    'Worst case: an attacker calls /api/game as fast as possible. Lambda bills 5–7 ms per call and runs at most 10 at once, so at most about 1,700 calls a second reach it; each is assumed to read and write an 11 KB game (a failed conditional write is still billed). This is a conservative bound: an attacker must keep learning the latest revision for a request to write at all. Throttled requests (429) never run Lambda and cost only the CloudFront request.'));
  root.append(table([t('部分', 'Part'), t('上限', 'Cap'), t('最坏每小时', 'Worst per hour')], [
    [t('Lambda 调用和计算', 'Lambda calls and compute'), t('并发 10（约 610 万次/小时）', 'Concurrency 10 (about 6.1 million calls an hour)'), num('≈ $1.40')],
    [t('DynamoDB 读取', 'DynamoDB reads'), t('每次调用最多 6 个读取单位（冲突时会再读一次）', 'up to 6 read units per call (a conflict reads again)'), num('≈ $5.20')],
    [t('DynamoDB 写入', 'DynamoDB writes'), t('每次调用 11 个写入单位', '11 write units per call'), num('≈ $47')],
    [t('CloudWatch 日志', 'CloudWatch Logs'), t('每次约 350 字节', 'about 350 bytes per call'), num('≈ $1.20')],
    [t('CloudFront 请求和流量', 'CloudFront requests and traffic'), t('没有上限：每百万次请求约 $1.30', 'No cap: about $1.30 per million requests'), num(t('每秒 1 万次时 ≈ $47', '≈ $47 at 10,000/s'))],
  ]));
  root.append(callout('budget', t('Lambda 一侧最多约每小时 $55，由并发上限保证；CloudFront 一侧随攻击者的请求速度线性增长，没有上限。要给它加上限，需要 AWS WAF 的速率规则（每月约 $6，加每百万次请求 $0.60）或账户级预算告警——这需要你来决定，因为会产生费用并影响整个账户。',
    'The Lambda side is capped at roughly $55 an hour by the concurrency limit; the CloudFront side grows with the attacker’s request rate and has no cap. Capping it needs an AWS WAF rate-based rule (about $6 a month plus $0.60 per million requests) or an account-wide budget alert — your decision, because it costs money and affects the whole account.')));

  add('h2', t('限制', 'Limits'));
  root.append(stats([
    ['2 KB', t('每个请求的最大大小', 'largest request'), 'filter'],
    [t('2,000 步', '2,000 moves'), t('每盘棋最多记录，远低于 DynamoDB 的 400 KB 上限', 'kept per game, well inside DynamoDB’s 400 KB item limit'), 'dynamodb'],
    ['10', t('Lambda 最多同时运行数', 'Lambda runs at once, at most'), 'lambda'],
    [t('20 秒', '20 s'), t('Lambda 超时', 'Lambda timeout'), 'clock'],
  ]));

  add('h2', t('线上渗透测试', 'Live penetration test'));
  add('p', t(`以下是 ${TEST_DATE} 21:47 UTC 对 https://xiangqi.dliu.com 运行 scripts/security-test.sh（make security-test）的结果（23:11 UTC 加入 /health、23:50 UTC 加入 /docs/health 跳转后重新运行）：104 项检查，全部通过。脚本用 curl、openssl 和 AWS CLI（只用来查找本堆栈的函数 URL、存储桶和 CloudFront 域名）。写入测试只使用过期的版本号或不可能合法的动作，脚本最后会确认棋局版本号没有变化。`,
    `Results of scripts/security-test.sh (make security-test) against https://xiangqi.dliu.com on ${TEST_DATE} at 21:47 UTC, rerun after adding /health (23:11 UTC) and the /docs/health redirect (23:50 UTC): 104 checks, all passed. It uses curl, openssl and the AWS CLI (only to look up this stack’s function URL, bucket and CloudFront domain). Write tests use only stale revisions or actions that can never be legal, and the script finally confirms that the game’s revision did not change.`));
  root.append(table([t('测试', 'Test'), t('预期', 'Expected'), t('实际', 'Actual'), t('日期', 'Date'), t('状态', 'Status')], [
    [t('HTTP 降级；http://host//evil.example 开放重定向', 'HTTP downgrade; open redirect via http://host//evil.example'), t('301 到 https://，仍在本站', '301 to https://, staying on this site'), '301 https://xiangqi.dliu.com/ ; https://xiangqi.dliu.com//evil.example/', date, PASS],
    [t('TLS 1.0、1.1 和弱加密套件（RC4、3DES、NULL、EXPORT、MD5）', 'TLS 1.0, 1.1 and weak ciphers (RC4, 3DES, NULL, EXPORT, MD5)'), t('拒绝', 'refused'), t('全部拒绝', 'all refused'), date, PASS],
    [t('TLS 1.2 和 1.3 证书', 'TLS 1.2 and 1.3 certificate'), 'verify OK', 'Verify return code: 0 (ok)', date, PASS],
    [t('/、/docs、/api/game、404 页面的安全响应头', 'Security headers on /, /docs, /api/game and the 404 page'), t('CSP、HSTS、DENY、nosniff、Referrer、Permissions；无 S3 头', 'CSP, HSTS, DENY, nosniff, Referrer, Permissions; no S3 headers'), t('4 个页面全部具备，没有泄露', 'all present on all 4, none leaked'), date, FIXED],
    [t('隐藏文件和源码映射：.git、.env、.DS_Store、package.json、cdk.json、Makefile、README、backend/、tests/、*.map、*.bak', 'Hidden files and source maps: .git, .env, .DS_Store, package.json, cdk.json, Makefile, README, backend/, tests/, *.map, *.bak'), t('不是 2xx', 'not 2xx'), t('15 个全部 404', 'all 15 return 404'), date, PASS],
    [t('路径穿越：/..%2f..%2fetc%2fpasswd、/%2e%2e/…、/docs/..%2f.env', 'Path traversal: /..%2f..%2fetc%2fpasswd, /%2e%2e/…, /docs/..%2f.env'), t('不是 2xx', 'not 2xx'), '400, 400, 404', date, PASS],
    [t('页面上的 POST、PUT、DELETE、PATCH、OPTIONS、TRACE', 'POST, PUT, DELETE, PATCH, OPTIONS, TRACE on pages'), t('拒绝', 'refused'), '404 ×5, 405', date, PASS],
    [t('/api/game 上的 PUT、DELETE、PATCH、TRACE', 'PUT, DELETE, PATCH, TRACE on /api/game'), '405', '405 ×4', date, PASS],
    [t('未知 API 路径：/api/、/api/game/、/api/x、/api/..%2fgame、/api/game%00、/api/game.json', 'Unknown API paths: /api/, /api/game/, /api/x, /api/..%2fgame, /api/game%00, /api/game.json'), '4xx', '404 ×5, 400', date, PASS],
    [t('直接调用 Lambda 函数 URL（GET 和 POST）', 'Lambda function URL called directly (GET and POST)'), '403', '403, 403', date, PASS],
    [t('直接读取 S3 对象、列出存储桶、S3 网站端点', 'S3 object read, bucket listing and website endpoint directly'), '403, 403, 4xx', '403, 403, 404', date, PASS],
    [t('伪造 Host 头', 'Spoofed Host header'), t('拒绝', 'refused'), '403', date, PASS],
    [t('*.cloudfront.net 默认域名', '*.cloudfront.net default domain'), t('能打开页面（已接受），但不能写入', 'serves pages (accepted) but cannot write'), t('200；写入被拒绝（见下）', '200; writes refused (below)'), date, ACCEPTED],
    [t('IDOR：?gameId=other，以及请求体中的 gameId', 'IDOR: ?gameId=other, and gameId in the body'), t('只有一盘棋，参数被忽略', 'one game only; the parameter is ignored'), t('同一版本号；409 返回同一棋局', 'same revision; 409 with the same game'), date, PASS],
    [t('缺少或错误的 x-amz-content-sha256', 'Missing or wrong x-amz-content-sha256'), t('签名检查拒绝', 'refused by the signature check'), t('403（显示为 404 页面）', '403 (shown as the 404 page)'), date, PASS],
    [t('跨站 POST，Origin 为 evil.example、blog.dliu.com、*.cloudfront.net、null、http://xiangqi.dliu.com', 'Cross-site POST with Origin evil.example, blog.dliu.com, *.cloudfront.net, null, http://xiangqi.dliu.com'), '403', t('5 个全部 403（显示为 404 页面）', 'all 5 refused with 403 (shown as the 404 page)'), date, PASS],
    [t('简单请求类型：text/plain、x-www-form-urlencoded、multipart/form-data', 'Simple-request types: text/plain, x-www-form-urlencoded, multipart/form-data'), '415', '415 ×3', date, PASS],
    [t('来自 evil.example 的 CORS 预检和跨站 GET', 'CORS preflight and cross-site GET from evil.example'), t('没有 Access-Control-Allow-*', 'no Access-Control-Allow-*'), t('0 个', 'none'), date, PASS],
    [t('畸形输入：错误 JSON、null、数组、字符串或负数或 1e308 的版本号', 'Malformed input: bad JSON, null, array, revision as text, negative or 1e308'), '400', '400 ×6', date, PASS],
    [t('注入：{"$ne":null} 作为动作类型、__proto__、constructor、原型污染', 'Injection: {"$ne":null} as the action type, __proto__, constructor, prototype pollution'), '400', '400 ×4', date, PASS],
    [t('落点：小数、字符串、-1 和 90、角到角、原地不动', 'Points: fractional, text, -1 and 90, corner to corner, a point to itself'), '400', '400 ×4', date, PASS],
    [t('过期版本号', 'Stale revision'), t('409 和最新棋局，不写入', '409 with the latest game, nothing written'), '409', date, PASS],
    [t('超过 2 KB 和 7 MB 的请求体', 'Bodies over 2 KB and of 7 MB'), '413', '413, 413', date, PASS],
    [t('路径和 API 查询字符串中的 CRLF', 'CRLF in the path and in the API query string'), t('不能注入 Set-Cookie', 'no injected Set-Cookie'), t('0 个', 'none'), date, PASS],
    [t('反射型 XSS：/?q=、/docs?q=、路径和 API 路径中的 <script>', 'Reflected XSS: <script> in /?q=, /docs?q=, the path and an API path'), t('不回显', 'not reflected'), t('4 处都没有回显', 'no reflection in all 4'), date, PASS],
    [t('存储型 XSS：棋局数据中的 HTML', 'Stored XSS: HTML in the game data'), t('服务器只保存合法棋子；浏览器拒绝未知阵营或类型', 'the server stores only legal pieces; the browser refuses unknown sides or types'), t('单元测试：伪造的 <img onerror> 棋子被拒绝，没有画出', 'unit test: a forged <img onerror> piece is refused and never drawn'), date, FIXED],
    [t('用 X-Forwarded-Host、X-Original-URL 等未入键请求头进行缓存投毒', 'Cache poisoning with unkeyed headers (X-Forwarded-Host, X-Original-URL and more)'), t('缓存的页面与正常页面相同', 'the cached page equals the real one'), t('哈希相同', 'identical hashes'), date, PASS],
    [t('缓存欺骗 /api/game/x.css；/api/game 是否被缓存', 'Cache deception /api/game/x.css; is /api/game cached'), t('404；no-store，从不命中', '404; no-store, never a Hit'), '404; no-store, Miss', date, PASS],
    [t('错误响应', 'Error responses'), t('没有堆栈、ARN 或内部路径', 'no stack traces, ARNs or internal paths'), t('没有', 'none'), date, PASS],
    [t('同时发出 40 个 API 读取', '40 simultaneous API reads'), t('只有 200 或 429（并发上限 10），没有 5xx', 'only 200 or 429 (concurrency cap 10), no 5xx'), '13×200, 27×429', date, FIXED],
    [t('网站设置的 Cookie', 'Cookies set by the site'), t('只有 dl_vid：Secure、HttpOnly、SameSite=Lax', 'only dl_vid: Secure, HttpOnly, SameSite=Lax'), t('符合', 'as expected'), date, PASS],
    [t('/health 带伪造的 Authorization、Cookie 和查询字符串；POST、DELETE', '/health with a forged Authorization header, cookie and query string; POST, DELETE'), t('200 application/health+json、pass、缓存 60 秒、无私密信息；写方法被拒绝', '200 application/health+json, pass, cached 60 s, nothing private; write methods refused'), t('符合；POST 和 DELETE 被拒绝', 'as expected; POST and DELETE refused'), date, PASS],
    [t('棋局在测试前后', 'The game before and after the tests'), t('版本号不变', 'revision unchanged'), '80 → 80', date, PASS],
  ]));
  add('p', t('不适用的测试：认证与授权绕过、过期或他人凭证、OAuth/OIDC（state、nonce、PKCE、redirect_uri、重放）和 JWT（alg none、aud、iss、azp、scope）——应用没有登录或令牌；文件上传滥用和预签名 URL 重用——没有上传；Markdown 和 SVG/HTML 上传造成的 XSS——用户不能提交任何文本；execute-api 绕过——没有 API Gateway；登录后的开放重定向——没有任何跳转参数。',
    'Not applicable: authentication and authorisation bypass, expired or other users’ credentials, OAuth/OIDC (state, nonce, PKCE, redirect_uri, replay) and JWT (alg none, aud, iss, azp, scope) — the app has no sign-in or tokens; upload abuse and presigned URL reuse — there are no uploads; Markdown and SVG/HTML-upload XSS — users cannot submit any text; execute-api bypass — there is no API Gateway; post-login open redirects — there are no redirect parameters.'), 'dg-note');

  add('h2', t('发现与修复', 'Findings and fixes'));
  root.append(table(['ID', t('严重性', 'Severity'), t('发现', 'Finding'), t('状态', 'Status'), t('提交', 'Commit')], [
    ['XQ-01', MEDIUM, t('没有内容安全策略和权限策略', 'No Content-Security-Policy or Permissions-Policy'), FIXED, mono('c9d2f1d')],
    ['XQ-02', MEDIUM, t('Lambda 没有并发上限，洪水可能占满账户共享的并发额度', 'No Lambda concurrency limit, so a flood could take the account’s shared concurrency'), FIXED, mono('c9d2f1d')],
    ['XQ-03', MEDIUM, t('没有速率限制：CloudFront 请求费用没有上限', 'No rate limit: CloudFront request charges have no cap'), DECIDE, '—'],
    ['XQ-04', MEDIUM, t('任何人都能修改或清空这盘共享的棋', 'Anyone can change or clear the shared game'), t('已接受（设计）', 'Accepted (by design)'), '—'],
    ['XQ-05', LOW, t('/api/game 没有安全响应头', '/api/game had no security headers'), FIXED, mono('c9d2f1d')],
    ['XQ-06', LOW, t('暴露 server: AmazonS3、x-amz-version-id、x-amz-server-side-encryption', 'server: AmazonS3, x-amz-version-id and x-amz-server-side-encryption exposed'), FIXED, mono('c9d2f1d')],
    ['XQ-07', LOW, t('浏览器未经检查就用 innerHTML 画出服务器数据（纵深防御）', 'The browser drew server data with innerHTML unchecked (defence in depth)'), FIXED, mono('c9d2f1d')],
    ['XQ-08', LOW, t('Lambda 角色使用 AWSLambdaBasicExecutionRole，可写入任何日志组', 'The Lambda role used AWSLambdaBasicExecutionRole, which can write to any log group'), FIXED, mono('2ef5d49')],
    ['XQ-09', LOW, t('棋局表没有删除保护', 'No deletion protection on the game table'), FIXED, mono('2ef5d49')],
    ['XQ-10', LOW, t('构建工具有 1 个严重、3 个高危 npm 公告（handlebars、brace-expansion、js-yaml、browserslist；只在构建和测试时运行）', 'Build tools had 1 critical and 3 high npm advisories (handlebars, brace-expansion, js-yaml, browserslist; build and test time only)'), FIXED, mono('2ef5d49')],
    ['XQ-11', LOW, t('GitHub Actions 引用可变的标签', 'GitHub Actions referenced by mutable tags'), FIXED, mono('2ef5d49')],
    ['XQ-12', LOW, t('GitHub Actions 部署依赖长期访问密钥（仓库目前没有配置，所以部署失败）', 'The GitHub Actions deploy relies on long-lived access keys (none are configured, so it fails)'), DECIDE, '—'],
    ['XQ-13', LOW, t('棋局没有备份（未启用时间点恢复）', 'The game has no backup (no point-in-time recovery)'), DECIDE, '—'],
    ['XQ-14', LOW, t('S3 旧版本永久保留（没有生命周期规则）', 'Old S3 object versions are kept forever (no lifecycle rule)'), DECIDE, '—'],
    ['XQ-15', LOW, t('证书辅助函数（已弃用的 DnsValidatedCertificate）对 "*" 拥有 acm 权限', 'The certificate helper (deprecated DnsValidatedCertificate) has acm actions on "*"'), ACCEPTED, '—'],
    ['XQ-16', LOW, t('*.cloudfront.net 默认域名也能打开网站', 'The *.cloudfront.net default domain also serves the site'), ACCEPTED, '—'],
    ['XQ-17', INFO, t('被拒绝的 API 请求（403）显示 HTML 的 404 页面', 'Refused API requests (403) show the HTML 404 page'), ACCEPTED, '—'],
    ['XQ-18', INFO, t('所有访客请求头（包括匿名的 dl_vid Cookie）都转发给 Lambda；Lambda 不使用、不记录', 'All viewer headers (including the anonymous dl_vid cookie) reach the Lambda, which neither uses nor logs them'), ACCEPTED, '—'],
    ['XQ-19', INFO, t('剩余的中低危 npm 公告：aws-cdk-lib 内置的 minimatch 和 Jest 工具链', 'Remaining moderate and low npm advisories: minimatch bundled in aws-cdk-lib, and the Jest toolchain'), ACCEPTED, '—'],
  ]));

  add('h2', t('代码审查', 'Code review'));
  root.append(list([
    t('backend/handler.cjs：只接受 /api/game 的 GET 和 POST；在解析前检查 Origin、JSON 类型和 2 KB 上限（包括 base64 请求体）；按版本号条件写入；意外错误只返回通用消息，日志只记录错误名称和消息。',
      'backend/handler.cjs: only GET and POST on /api/game; Origin, JSON type and the 2 KB limit (base64 bodies included) are checked before parsing; writes are conditional on the revision; unexpected errors return a generic message and log only the error name and message.'),
    t('backend/game-service.js：版本号必须是安全整数，落点必须是 0–89 的整数，动作类型只能是 5 个固定字符串之一；每步棋都用 engine.js 检查；每盘最多 2,000 步；版本号只增不减。用户提供的键从不用于动态属性访问。',
      'backend/game-service.js: revisions must be safe integers, points integers 0–89, and the action one of five fixed strings; every move is checked with engine.js; games are capped at 2,000 moves; revisions only grow. User-supplied keys are never used for dynamic property access.'),
    t('src/engine.js：纯函数，循环有界（90 个点），没有 eval 或动态代码。',
      'src/engine.js: pure functions with bounded loops (90 points), no eval or dynamic code.'),
    t('src/app.js：innerHTML 只用于检查过的棋子和固定的翻译文本；服务器消息用 textContent；只请求同源的 /api/game；localStorage 只保存固定的枚举值。i18n.js、docs.js、diagram.js 只用 textContent。',
      'src/app.js: innerHTML is used only with checked pieces and fixed translated text; server messages use textContent; it only calls same-origin /api/game; localStorage holds only fixed enum values. i18n.js, docs.js and diagram.js use textContent only.'),
    t('cdk/lib/xiangqi-site-stack.ts：Lambda 角色只有 4 个权限，没有 "*"；存储桶禁止公开访问、禁用 ACL、加密、拒绝非 HTTPS，只允许这个分发 GetObject；函数 URL 只允许这个分发调用；表加密并有删除保护；两个 Lambda（棋局 API 和证书辅助函数）的日志都写入本堆栈的日志组，保留 90 天。',
      'cdk/lib/xiangqi-site-stack.ts: the Lambda role has 4 permissions and no "*"; the bucket blocks public access, disables ACLs, is encrypted, denies non-HTTPS and lets only this distribution GetObject; only this distribution may invoke the function URL; the table is encrypted with deletion protection; both Lambdas (the game API and the certificate helper) log to this stack’s log groups, kept 90 days.'),
    t('scripts/dev-server.mjs 只监听 127.0.0.1，并防止路径穿越；.github/workflows/deploy.yml 只有 contents: read 权限。',
      'scripts/dev-server.mjs listens only on 127.0.0.1 and guards against path traversal; .github/workflows/deploy.yml has only contents: read.'),
    t('测试：52 个 Node 测试和 8 个 CDK 测试覆盖安全路径——注入式请求体、Origin（包括 null 和其他 dliu.com 网站）、内容类型、超大请求体、并发写入、无泄露的 500、伪造的棋局数据、响应头、IAM 权限、删除保护和日志保留。',
      'Tests: 52 Node tests and 8 CDK tests cover the security paths — injection-style bodies, Origin (including null and other dliu.com sites), content types, oversized bodies, concurrent writes, leak-free 500s, forged game data, response headers, IAM permissions, deletion protection and log retention.'),
  ]));

  add('h2', t('依赖与密钥扫描', 'Dependency and secret scans'));
  root.append(table([t('扫描', 'Scan'), t('结果', 'Result')], [
    [mono('gitleaks git --log-opts=--all'), t('完整 git 历史：没有发现泄露', 'Full git history: no leaks found')],
    [mono('gitleaks dir'), t('3 个误报：被 .gitignore 忽略的 cdk/cdk.out 中的资源内容哈希', '3 false positives: asset content hashes in the git-ignored cdk/cdk.out')],
    [mono('npm audit --omit=dev (cdk/)'), t('0 严重、0 高危、2 中危（aws-cdk-lib 内置的 minimatch，只在部署时处理可信输入，暂无修复）', '0 critical, 0 high, 2 moderate (minimatch bundled in aws-cdk-lib; deploy time only, trusted input, no fix yet)')],
    [mono('npm audit (cdk/, with dev)'), t('0 严重、0 高危、18 中危、4 低危（Jest 工具链；修复前为 1 严重、3 高危）', '0 critical, 0 high, 18 moderate, 4 low (the Jest toolchain; before the fix: 1 critical, 3 high)')],
    [t('运行时依赖', 'Runtime dependencies'), t('无：浏览器不加载第三方脚本；Lambda 只用 Node.js 和运行时自带的 AWS SDK', 'None: the browser loads no third-party scripts; the Lambda uses only Node.js and the AWS SDK in the runtime')],
  ]));

  add('h2', t('已接受的剩余风险', 'Accepted residual risks'));
  root.append(list([
    t('任何人都能修改这盘共享的棋，包括开始新局清空当前棋局。没有账户、房间或座位，这是有意的设计；“我是红方/黑方”只是本地设置。',
      'Anyone can change the shared game, including starting a new one that clears it. There are no accounts, rooms or seats by design; “I play Red/Black” is only a local setting.'),
    t('没有 WAF 或速率限制（XQ-03，待你决定）。Lambda 一侧的费用有上限，CloudFront 请求费用没有。',
      'There is no WAF or rate limit (XQ-03, your decision). The Lambda side of the bill is capped; CloudFront request charges are not.'),
    t('棋局没有备份（XQ-13，待你决定：时间点恢复会产生费用）；S3 旧版本永久保留（XQ-14，待你决定：清理会删除数据）。',
      'The game has no backup (XQ-13, your decision: point-in-time recovery costs money); old S3 versions are kept forever (XQ-14, your decision: expiring them deletes data).'),
    t('GitHub Actions 依赖长期访问密钥（XQ-12，待你决定：改用 OIDC 角色需要修改 IAM）。',
      'GitHub Actions relies on long-lived access keys (XQ-12, your decision: an OIDC role needs an IAM change).'),
    t('证书辅助函数的 acm 权限作用于 "*"，因为 ACM 的 RequestCertificate 不支持资源级权限；它只在部署时运行。',
      'The certificate helper’s acm actions apply to "*" because ACM’s RequestCertificate has no resource-level permissions; it runs only at deploy time.'),
    t('被拒绝的 API 请求显示 CloudFront 的 404 页面；网站也能通过 *.cloudfront.net 访问，但从那里不能写入。',
      'Refused API requests show CloudFront’s 404 page; the site is also reachable at *.cloudfront.net, but cannot be written to from there.'),
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

  add('p', t('源代码：dliu-com/xiangqi（cdk/lib/xiangqi-site-stack.ts、backend/、scripts/security-test.sh）。',
    'Source: dliu-com/xiangqi (cdk/lib/xiangqi-site-stack.ts, backend/, scripts/security-test.sh).'), 'source');
}

const BUILDERS = { architecture, cost, security, health };

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
  document.title = `${t(...TITLES[current])} · ${t('文档 · DL 中国象棋', 'Docs · DL Xiangqi')}`;
  if (scroll) window.scrollTo(0, 0);
}

build();
show(false);
window.addEventListener('hashchange', () => show(true));
window.addEventListener(LANGUAGE_EVENT, () => { build(); show(false); });
