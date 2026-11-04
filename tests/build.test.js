import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSite, hash } from '../scripts/build-site.mjs';

const ASSET = /\b(?:src|href)="\/([\w.-]+\.(?:js|css|svg))(\?v=([0-9a-f]+))?"/g;
const IMPORT = /(?:\bfrom\s+|\bimport\s+|\bimport\()['"]\.\/([\w.-]+\.js)(\?v=([0-9a-f]+))?['"]/g;

function build() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiangqi-build-'));
  buildSite(dir);
  const read = name => readFileSync(path.join(dir, name), 'utf8');
  return { dir, read, files: readdirSync(dir) };
}

test('every page loads its scripts, stylesheet and logo with ?v= of the exact file published', () => {
  const { dir, read, files } = build();
  try {
    for (const page of files.filter(name => name.endsWith('.html'))) {
      const refs = [...read(page).matchAll(ASSET)];
      assert.ok(refs.length >= 3, page);
      for (const [match, asset, query, version] of refs) {
        assert.ok(query, `${page}: ${match} has no version`);
        assert.equal(version, hash(read(asset)), `${page}: ${asset}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every module imports the others with ?v= of the exact file published, so changes ripple up to the page', () => {
  const { dir, read, files } = build();
  try {
    let imports = 0;
    for (const script of files.filter(name => name.endsWith('.js'))) {
      for (const [match, dependency, query, version] of read(script).matchAll(IMPORT)) {
        imports++;
        assert.ok(query, `${script}: ${match} has no version`);
        assert.equal(version, hash(read(dependency)), `${script} → ${dependency}`);
      }
    }
    assert.ok(imports >= 8);
    // The page's app.js version covers engine.js: app.js names engine.js's version in its text.
    assert.ok(read('app.js').includes(`./engine.js?v=${hash(read('engine.js'))}`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the source stays unversioned, and the publish script uploads the build and every file it references', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), /\?v=/);
  const publish = readFileSync(new URL('../scripts/publish-site.sh', import.meta.url), 'utf8');
  assert.match(publish, /node "\$PROJECT_DIR\/scripts\/build-site\.mjs" "\$BUILD"/);
  assert.doesNotMatch(publish.slice(publish.indexOf('build-site.mjs')), /\$PROJECT_DIR\/src\//);
  const uploaded = publish.match(/for filename in ([^;]+); do/)[1].split(/\s+/);
  const { dir, read, files } = build();
  try {
    const referenced = new Set();
    for (const name of files) {
      for (const [, asset] of read(name).matchAll(name.endsWith('.html') ? ASSET : IMPORT)) referenced.add(asset);
    }
    for (const asset of referenced) assert.ok(uploaded.includes(asset), `${asset} is referenced but not uploaded`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
