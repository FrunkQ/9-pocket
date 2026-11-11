// Parses the checklist table Upper Deck publishes on its /checklist/ pages.
// Column sets differ slightly between products, so cells are mapped by header.
import { readFileSync } from 'node:fs';

const ENTITIES = {
  '&amp;': '&', '&#039;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>',
  '&nbsp;': ' ', '&#8217;': "'", '&#8216;': "'", '&#8211;': '-', '&#8212;': '-', '&#038;': '&',
};

function decode(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldFor(header) {
  const h = header.toLowerCase();
  if (h.startsWith('set name')) return 'set';
  if (h === 'card') return 'card';
  if (h.startsWith('description') || h.startsWith('player')) return 'name';
  if (h.startsWith('team city')) return 'city';
  if (h.startsWith('team name')) return 'team';
  if (h.startsWith('rookie')) return 'rookie';
  if (h.startsWith('auto')) return 'auto';
  if (h.includes('mem') || h.includes('tech')) return 'mem';
  if (h.includes("#'d")) return 'serial';
  if (h.startsWith('sp')) return 'sp';
  if (h.includes('odds')) return 'odds';
  if (h.startsWith('point')) return 'point';
  return null;
}

export function parseUdTable(path) {
  const html = readFileSync(path, 'utf8');
  const start = html.indexOf('<table class="csv-table">');
  if (start < 0) throw new Error(`No checklist table in ${path}`);
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);

  const headEnd = table.indexOf('</thead>');
  const fields = [];
  const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
  let h;
  while ((h = thRe.exec(table.slice(0, headEnd < 0 ? 4000 : headEnd)))) fields.push(fieldFor(decode(h[1])));
  if (!fields.includes('set') || !fields.includes('card')) throw new Error(`Unexpected columns in ${path}`);

  const rows = [];
  const seen = new Set();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(table))) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let c;
    while ((c = cellRe.exec(m[1]))) cells.push(decode(c[1]));
    if (cells.length < 5) continue;
    const key = cells.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { set: '', card: '', name: '', city: '', team: '', rookie: '', auto: '', mem: '', serial: '', sp: '', odds: '', point: '' };
    fields.forEach((f, i) => {
      if (f) row[f] = cells[i] ?? '';
    });
    rows.push(row);
  }
  return { rows, tableBytes: table.length, htmlBytes: html.length };
}
