// Chinese / English. Chinese is the default; choosing English in the header switcher is saved in this browser
// (localStorage) and wins on later visits. Static pages are written in Chinese: data-en holds an element's English
// text, data-en-label its English aria-label. Changing language translates the page in place and fires
// 'xiangqi-language-change' so the page scripts can redraw what they built.

const KEY = 'xiangqi-language';
export const LANGUAGE_EVENT = 'xiangqi-language-change';

export function initialLanguage(saved) {
  return saved === 'en' ? 'en' : 'zh';
}

let saved = null;
try { saved = localStorage.getItem(KEY); } catch { /* Storage blocked: Chinese for this visit. */ }
let language = initialLanguage(saved);

export const currentLanguage = () => language;
/** t('中文', 'English') */
export const t = (zh, en) => (language === 'en' ? en : zh);

export const SIDE_NAMES = { red: ['红方', 'Red'], black: ['黑方', 'Black'] };
export const PIECE_NAMES = {
  general: ['将帅', 'General'], advisor: ['士', 'Advisor'], elephant: ['象', 'Elephant'], horse: ['马', 'Horse'],
  chariot: ['车', 'Chariot'], cannon: ['炮', 'Cannon'], soldier: ['兵卒', 'Soldier'],
};
export const RULES_EN = {
  general: 'Moves one point along a line inside the palace. The two generals may never face each other on the same file with nothing between them.',
  advisor: 'Moves one point diagonally and never leaves the palace.',
  elephant: 'Moves exactly two points diagonally. It cannot cross the river, and it is blocked when the point in between is occupied.',
  horse: 'Moves one point straight, then one point diagonally outwards. A piece next to it in the first direction blocks it (“hobbling the horse”).',
  chariot: 'Moves any number of points along a rank or file, without jumping over pieces.',
  cannon: 'Moves like a chariot, but captures only by jumping over exactly one piece (the “screen”).',
  soldier: 'Moves one point forward. After crossing the river it may also move one point sideways. It never moves back.',
};
export const sideName = side => t(...SIDE_NAMES[side]);
export const pieceName = type => t(...PIECE_NAMES[type]);

// Messages the game API sends, in Chinese. Anything unknown is shown as sent.
const ERRORS = {
  '棋局版本无效，请刷新后重试。': 'Invalid game version. Refresh and try again.',
  '棋局已更新，已为你同步最新进度。': 'The game changed; you now have the latest position.',
  '操作无效。': 'Invalid action.',
  '还没有可以撤回的走棋。': 'There is no move to undo yet.',
  '棋局已经结束，请开始新局。': 'The game is over. Start a new game.',
  '落点无效。': 'Invalid point.',
  '这步棋不符合规则，请重新选择。': 'That move is not legal. Choose again.',
  '本局记录已满，请和棋或开始新局。': 'This game’s record is full. Agree a draw or start a new game.',
  '不支持的操作。': 'Unsupported action.',
  '页面不存在。': 'Not found.',
  '不支持此请求方法。': 'Method not allowed.',
  '请求来源无效。': 'Request origin refused.',
  '请使用 JSON 格式。': 'Send JSON.',
  '请求过大。': 'Request too large.',
  '请求格式无效。': 'Malformed request.',
  '棋局暂时无法同步，请稍后重试。': 'The game cannot be synced right now. Please try again later.',
};
export function translateError(message) {
  if (language !== 'en' || !message) return message;
  return ERRORS[message] || message;
}

export function translatePage(root = document) {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  for (const node of root.querySelectorAll('[data-en]')) {
    if (node.dataset.zh == null) node.dataset.zh = node.textContent;
    const text = t(node.dataset.zh, node.dataset.en);
    if (node.textContent !== text) node.textContent = text;
  }
  for (const node of root.querySelectorAll('[data-en-label]')) {
    if (node.dataset.zhLabel == null) node.dataset.zhLabel = node.getAttribute('aria-label') || '';
    node.setAttribute('aria-label', t(node.dataset.zhLabel, node.dataset.enLabel));
  }
  for (const node of root.querySelectorAll('meta[data-en-content]')) {
    if (node.dataset.zhContent == null) node.dataset.zhContent = node.content;
    node.content = t(node.dataset.zhContent, node.dataset.enContent);
  }
  for (const button of document.querySelectorAll('.dl-languages [data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

export function setLanguage(value, { save = true } = {}) {
  const next = value === 'en' ? 'en' : 'zh';
  const changed = next !== language;
  language = next;
  if (save) try { localStorage.setItem(KEY, language); } catch { /* Keep the choice for this page only. */ }
  translatePage();
  if (changed) window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }));
}

// Wires the shared dl-language switcher (dl.css) that each page has last in its dl-nav: 中文 | English side by side,
// or a 文/A button that opens them on narrow screens.
function wireSwitcher() {
  const box = document.querySelector('.dl-header .dl-language');
  if (!box) return;
  const toggle = box.querySelector('.dl-language-toggle');
  const group = box.querySelector('.dl-languages');
  const setOpen = open => {
    group.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  for (const button of group.querySelectorAll('[data-language]')) {
    button.addEventListener('click', () => { setOpen(false); setLanguage(button.dataset.language); });
  }
  toggle.addEventListener('click', () => setOpen(!group.classList.contains('is-open')));
  document.addEventListener('click', event => { if (!box.contains(event.target)) setOpen(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && group.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
  });
}

if (typeof document !== 'undefined') {
  wireSwitcher();
  translatePage();
}
