// Downloads every NHL checklist Upper Deck publishes into data/raw/ud/.
//
//   node scripts/fetch-ud-hockey.mjs            fetch anything not yet saved
//   node scripts/fetch-ud-hockey.mjs --list     only list what the index has
//
// It walks the paginated index at /checklist-license/nhl/, waits between
// requests, and skips pages already on disk, so it can be re-run safely.
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const INDEX = 'https://upperdeck.com/checklist-license/nhl/';
const OUT = 'data/raw/ud';
const UA = 'Mozilla/5.0 (compatible; checklist-fetch/1.0)';
const PAUSE_MS = 1500;
// One page repeats its table until it is over 100 MB; stop reading well before that.
const MAX_BYTES = 12 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function indexPage(n) {
  const url = n === 1 ? INDEX : `${INDEX}page/${n}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const links = [...html.matchAll(/href="(https:\/\/upperdeck\.com\/checklist\/[^"]+)"/g)].map((m) => m[1]);
  return [...new Set(links)];
}

async function save(url, path) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.body) throw new Error(`no body (${res.status})`);
  let bytes = 0;
  const reader = res.body.getReader();
  const limited = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done || bytes > MAX_BYTES) {
        if (!done) await reader.cancel().catch(() => undefined);
        this.push(null);
        return;
      }
      bytes += value.length;
      this.push(value);
    },
  });
  await pipeline(limited, createWriteStream(path));
  return { status: res.status, bytes };
}

const listOnly = process.argv.includes('--list');
mkdirSync(OUT, { recursive: true });

const all = [];
for (let n = 1; n <= 60; n++) {
  let links = await indexPage(n);
  if (!links) {
    // One slow page should not cut the list short: try it once more.
    await sleep(4000);
    links = await indexPage(n);
  }
  if (!links || links.length === 0) break;
  const fresh = links.filter((l) => !all.includes(l));
  if (fresh.length === 0) break;
  all.push(...fresh);
  await sleep(600);
}
console.log(`${all.length} checklists in the index`);
writeFileSync(`${OUT}/index.json`, JSON.stringify(all, null, 1));
if (listOnly) {
  for (const l of all) console.log(l);
  process.exit(0);
}

let fetched = 0;
for (const url of all) {
  const slug = url.replace(/\/$/, '').split('/').pop();
  const path = `${OUT}/${slug}.html`;
  if (existsSync(path)) continue;
  try {
    const { status, bytes } = await save(url, path);
    fetched++;
    console.log(`${status} ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${slug}`);
  } catch (e) {
    console.log(`FAILED ${slug}: ${e.message}`);
  }
  await sleep(PAUSE_MS);
}
console.log(`done, ${fetched} new`);
