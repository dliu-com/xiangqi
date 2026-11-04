import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The public, canonical HTML pages. Not listed: /docs/health (301 to /docs#health), /docs/health.md (machine-readable
// copy of the Health tab), /api/game and /health (JSON), error pages and assets. Docs tabs are fragments of /docs.
const PAGES = { 'https://xiangqi.dliu.com/': 'src/index.html', 'https://xiangqi.dliu.com/docs': 'src/docs.html' };

test('the sitemap lists exactly the public pages, each a real HTML page without noindex', () => {
  const sitemap = read('src/sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  assert.deepEqual(locs, Object.keys(PAGES));
  assert.equal((sitemap.match(/<url>/g) || []).length, locs.length);
  for (const [loc, file] of Object.entries(PAGES)) {
    assert.doesNotMatch(loc, /[#?]|\/docs\/health|\/api\/|\/health$|404/, loc);
    assert.doesNotMatch(read(file), /noindex/i, file);
  }
});

test('robots.txt allows crawling and points to the sitemap, and both are published', () => {
  assert.equal(read('src/robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://xiangqi.dliu.com/sitemap.xml\n');
  const publish = read('scripts/publish-site.sh');
  const uploaded = publish.match(/for filename in ([^;]+); do/)[1].split(/\s+/);
  assert.ok(uploaded.includes('robots.txt') && uploaded.includes('sitemap.xml'));
  assert.ok(publish.includes("*.xml) mime='application/xml; charset=utf-8' ;;"));
  assert.ok(publish.includes("*.txt) mime='text/plain; charset=utf-8' ;;"));
});
