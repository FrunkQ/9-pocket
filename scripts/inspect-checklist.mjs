// Usage: node scripts/inspect-checklist.mjs data/raw/<file>.html
// Prints each subset in an Upper Deck checklist page with its card count.
import { parseUdTable } from './lib/ud-table.mjs';

const { rows, tableBytes, htmlBytes } = parseUdTable(process.argv[2]);
console.log(`rows ${rows.length}, table ${tableBytes} bytes of ${htmlBytes}`);

const bySet = new Map();
for (const r of rows) {
  if (!bySet.has(r.set)) bySet.set(r.set, []);
  bySet.get(r.set).push(r);
}
for (const [set, list] of bySet) {
  const first = list[0];
  const last = list[list.length - 1];
  const serials = [...new Set(list.map((r) => r.serial).filter(Boolean))].slice(0, 3).join(',');
  const odds = [...new Set(list.map((r) => r.odds).filter(Boolean))].slice(0, 2).join(' / ');
  console.log(
    `${String(list.length).padStart(4)}  ${set}  [${first.card}..${last.card}]` +
      (serials ? `  serial:${serials}` : '') +
      (odds ? `  odds:${odds}` : ''),
  );
}
