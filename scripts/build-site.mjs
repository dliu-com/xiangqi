// Builds the publishable site into a directory (default dist/): every local script, stylesheet and logo URL in the
// HTML, and every relative import between modules, gets ?v=<content hash>. A new page therefore always loads the
// scripts it was built with, even though scripts are cached for a day; CloudFront's cache key includes v.
//   node scripts/build-site.mjs [outDir]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const IMPORT = /(\bfrom\s+|\bimport\s+|\bimport\()(['"])\.\/([\w.-]+\.js)\2/g;
// src="/x.js", href="/x.css" and the logo, but not links to pages (/docs) or other sites.
const ASSET = /\b(src|href)="\/([\w.-]+\.(?:js|css|svg))"/g;

export const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 12);

export function buildSite(outDir) {
  const files = readdirSync(SRC).filter(name => !name.startsWith('.'));
  const output = new Map();
  const versions = new Map();

  // A module's version is the hash of its text after its own imports are versioned, so a change anywhere below
  // a module changes every module that imports it, up to the page.
  const versionOf = (name, seen = []) => {
    if (versions.has(name)) return versions.get(name);
    if (!files.includes(name)) throw new Error(`${seen.at(-1) || 'page'} refers to missing ${name}`);
    if (seen.includes(name)) throw new Error(`import cycle: ${[...seen, name].join(' → ')}`);
    let text = readFileSync(path.join(SRC, name), 'utf8');
    if (name.endsWith('.js')) {
      text = text.replace(IMPORT, (match, start, quote, dependency) => `${start}${quote}./${dependency}?v=${versionOf(dependency, [...seen, name])}${quote}`);
    }
    output.set(name, text);
    versions.set(name, hash(text));
    return versions.get(name);
  };

  for (const name of files) {
    if (name.endsWith('.html')) {
      output.set(name, readFileSync(path.join(SRC, name), 'utf8').replace(ASSET, (match, attribute, asset) => `${attribute}="/${asset}?v=${versionOf(asset)}"`));
    } else if (/\.(js|css|svg)$/.test(name)) {
      versionOf(name);
    } else {
      output.set(name, readFileSync(path.join(SRC, name), 'utf8'));
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of output) writeFileSync(path.join(outDir, name), text);
  return { files: [...output.keys()], versions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] || fileURLToPath(new URL('../dist/', import.meta.url)));
  const { files } = buildSite(outDir);
  console.log(`Built ${files.length} files into ${outDir}`);
}
