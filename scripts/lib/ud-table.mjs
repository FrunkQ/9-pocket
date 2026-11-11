// Parses the checklist table Upper Deck publishes on its /checklist/ pages.
// Column sets differ between products, and some pages put a title in the
// header row with the real column names a row or two below, so the heading
// row is found by content and cells are mapped by heading.
import { readFileSync } from 'node:fs';

const ENTITIES = {
  '&amp;': '&', '&#039;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>',
  '&nbsp;': ' ', '&#8217;': "'", '&#8216;': "'", '&#8211;': '-', '&#8212;': '-', '&#038;': '&',
};

function decode(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m] ?? m)
    .replace(/﻿/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldFor(header) {
  const h = header.toLowerCase();
  if (h.startsWith('set name') || h === 'set') return 'set';
  if (h === 'card' || h === 'card #' || h === 'card number' || h === 'card no.') return 'card';
  if (h.startsWith('description') || h.startsWith('player')) return 'name';
  if (h.startsWith('team city') || h === 'city') return 'city';
  if (h.startsWith('team name') || h === 'team') return 'team';
  if (h.startsWith('rookie')) return 'rookie';
  if (h.startsWith('auto')) return 'auto';
  if (h.includes('mem') || h.includes('tech')) return 'mem';
  if (h.includes("#'d") || h.startsWith('serial')) return 'serial';
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

  // Every row as its cells, header cells included.
  const lines = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(table))) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let c;
    while ((c = cellRe.exec(m[1]))) cells.push(decode(c[1]));
    if (cells.length) lines.push(cells);
  }

  // The heading row is the first one naming both the set and the card number.
  let fields = null;
  let first = 0;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const mapped = lines[i].map(fieldFor);
    if (mapped.includes('set') && mapped.includes('card')) {
      fields = mapped;
      first = i + 1;
      break;
    }
  }
  if (!fields) throw new Error(`Unexpected columns in ${path}`);

  const rows = [];
  const seen = new Set();
  for (let i = first; i < lines.length; i++) {
    const cells = lines[i];
    if (cells.length < 3) continue;
    const key = cells.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { set: '', card: '', name: '', city: '', team: '', rookie: '', auto: '', mem: '', serial: '', sp: '', odds: '', point: '' };
    fields.forEach((f, j) => {
      if (f) row[f] = cells[j] ?? '';
    });
    // A repeated heading row inside the table is not a card.
    if (fieldFor(row.set) === 'set' && fieldFor(row.card) === 'card') continue;
    rows.push(row);
  }
  return { rows, tableBytes: table.length, htmlBytes: html.length };
}
