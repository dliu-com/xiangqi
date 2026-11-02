import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const DL_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">';
const DL_ICON = 'https://files.dliu.com/dliu.com/favicon.png';
const PAGES = ['src/index.html', 'src/404.html'];

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
    assert.ok(page.includes('<a class="dl-brand" href="/"><img class="dl-logo" src="/favicon.svg" alt="" width="32" height="32">中国象棋</a>'), file);
    assert.match(page, /<main class="dl-main[" ]/, file);
    assert.ok(page.includes(`<footer class="dl-footer"><a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${DL_ICON}" alt="" width="24" height="24"></a> <a href="https://dliu.com">dliu.com</a>`), file);
  }
  assert.ok(existsSync(new URL('../src/favicon.svg', import.meta.url)));
});

test('buttons, toggles and dialogs use the shared components', () => {
  const page = read('src/index.html');
  for (const [, attributes] of page.matchAll(/<button([^>]*)>/g)) {
    assert.match(attributes, /class="[^"]*\bdl-(button|dialog-close)\b|^ id="(mode|side)-/, attributes);
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
