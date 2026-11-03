import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const DL_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">';
const DL_ICON = 'https://files.dliu.com/dliu.com/favicon.png';
const DOCS_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
const PAGES = ['src/index.html', 'src/404.html', 'src/docs.html'];
const LANGUAGE_SWITCHER = `<div class="dl-language">
        <button type="button" class="dl-button dl-language-toggle" aria-controls="dl-languages" aria-expanded="false" aria-label="Language / 语言">文/A</button>
        <div id="dl-languages" class="dl-languages" role="group" aria-label="Language / 语言">
          <button type="button" data-language="zh" lang="zh-CN" aria-pressed="true">中文</button>
          <button type="button" data-language="en" lang="en" aria-pressed="false">English</button>
        </div>
      </div>
    </nav>`;

test('every page loads the shared dliu.com stylesheet before its own', () => {
  for (const file of PAGES) {
    const page = read(file);
    assert.ok(page.includes(DL_CSS), file);
    assert.ok(page.indexOf(DL_CSS) < page.indexOf('<link rel="stylesheet" href="/styles.css">'), file);
  }
});

test('every page has the shared header with the 象 seal, and the shared footer with the DL logo', () => {
  for (const file of PAGES) {
    const page = read(file);
    assert.ok(page.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'), file);
    assert.ok(page.includes('<body class="dl-page">'), file);
    assert.ok(page.includes('<a class="dl-brand" href="/"><img class="dl-logo" src="/favicon.svg" alt="" width="32" height="32"><span data-en="Xiangqi">中国象棋</span></a>'), file);
    assert.match(page, /<main class="dl-main[" ]/, file);
    assert.ok(page.includes(`<footer class="dl-footer"><a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${DL_ICON}" alt="" width="24" height="24"></a> <a href="https://dliu.com">dliu.com</a>`), file);
    assert.match(page, / · <a href="\/docs" data-en="Docs">文档<\/a><\/footer>/, file);
  }
  assert.ok(existsSync(new URL('../src/favicon.svg', import.meta.url)));
});

test('every page has Docs in the menu bar and the Chinese/English switcher last', () => {
  for (const file of PAGES) {
    const page = read(file);
    const nav = page.slice(page.indexOf('<nav class="dl-nav"'), page.indexOf('</nav>') + 6);
    assert.match(nav, /<a class="dl-button" href="\/docs"( aria-current="page")? data-en="Docs">文档<\/a>/, file);
    assert.ok(nav.endsWith(LANGUAGE_SWITCHER), file);
    assert.match(page, /<script type="module" src="\/(app|i18n|docs)\.js"><\/script>/, file);
  }
});

test('the docs page uses the shared docs look, with architecture, cost and security tabs', () => {
  const page = read('src/docs.html');
  assert.ok(page.indexOf(DL_CSS) < page.indexOf(DOCS_CSS) && page.indexOf(DOCS_CSS) < page.indexOf('/styles.css'));
  assert.ok(page.includes('<main class="dl-main dl-docs-main">'));
  assert.ok(page.includes('<nav class="dl-tabs"'));
  for (const tab of ['architecture', 'cost', 'security']) {
    assert.ok(page.includes(`href="/docs#${tab}" data-tab="${tab}"`), tab);
    assert.ok(page.includes(`<article id="${tab}" class="dl-docs"`), tab);
  }
  assert.ok(readFileSync(new URL('../scripts/publish-site.sh', import.meta.url), 'utf8').includes('src/docs.html" "s3://$SITE_BUCKET_NAME/docs"'));
});

test('every Chinese text in the static pages has an English version', () => {
  // app.js rewrites these on every render, in the chosen language.
  const DYNAMIC = ['mode-help', 'turn-kicker', 'turn-title', 'status-detail', 'sync-status', 'move-count', 'confirm-title', 'confirm-description', 'confirm-accept'];
  const app = read('src/app.js');
  for (const id of DYNAMIC) assert.match(app, new RegExp(`\\$\\('${id}'\\)\\.textContent = `), id);
  for (const file of PAGES) {
    const page = read(file).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<script[\s\S]*?<\/script>|<noscript>[\s\S]*?<\/noscript>/g, '');
    for (const [, tag, attributes, text] of page.matchAll(/<(\w+)([^>]*)>([^<]*\p{Script=Han}[^<]*)</gu)) {
      if (/\blang="zh/.test(attributes) || ['中文', '文/A'].includes(text.trim()) || /^[将帅]$/.test(text.trim())) continue;
      if (DYNAMIC.some(id => attributes.includes(`id="${id}"`))) continue;
      assert.match(attributes, /data-en="[^"]+"/, `${file}: <${tag}${attributes}>${text}`);
    }
    for (const [, attributes] of page.matchAll(/<\w+([^>]*\baria-label="[^"]*\p{Script=Han}[^"]*"[^>]*)>/gu)) {
      if (/aria-label="Language \/ 语言"/.test(attributes)) continue;
      assert.match(attributes, /data-en-label="[^"]+"/, `${file}: ${attributes}`);
    }
  }
});

test('buttons, toggles and dialogs use the shared components', () => {
  const page = read('src/index.html');
  for (const [, attributes] of page.matchAll(/<button([^>]*)>/g)) {
    assert.match(attributes, /class="[^"]*\bdl-(button|dialog-close)\b|^ id="(mode|side)-|^ type="button" data-language="(zh|en)"/, attributes);
  }
  assert.equal((page.match(/class="dl-segmented /g) || []).length, 2);
  assert.equal((page.match(/<dialog [^>]*class="dl-dialog /g) || []).length, 2);
});

test('the app stylesheet leaves the header, buttons, dialogs and palette to the shared stylesheet', () => {
  const css = read('src/styles.css');
  assert.doesNotMatch(css, /\.(site-header|brand|button|text-button|icon-button|modal|site-footer|app-shell|sr-only)\b/);
  assert.doesNotMatch(css, /color-scheme|--(bg|panel|ink|muted|line|gold|red):/);
  assert.doesNotMatch(css, /^\s*(h1|h2|button|a|body)\s*\{[^}]*\b(font|color|background)/m);
});
