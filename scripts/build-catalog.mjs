// Builds the hockey catalogue the app serves from public/catalog/hockey/:
// one JSON file per set, an index of all sets, and a player index used to
// work out which sets a scanned card could belong to.
//
//   node scripts/fetch-ud-hockey.mjs     download Upper Deck's checklist pages
//   node scripts/build-catalog.mjs       turn them into the catalogue
//
// Each set becomes: base sections (the numbered set you put in a binder),
// the parallels that exist for those base cards, and insert sets with their
// own parallels.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { parseUdTable } from './lib/ud-table.mjs';
import { teamAbbr } from './lib/teams.mjs';

const RAW = 'data/raw/ud';
const OUT = 'public/catalog/hockey';
// Pages that had to be fetched whole by hand (the normal fetch stops at 12 MB).
const RAW_OVERRIDE = { '2023-24-sp-authentic-checklist': 'data/raw/spa-ud.html' };

// "Base Set - <suffix>" becomes a binder section with this label.
const SECTION_ALIAS = {
  'Autographed Future Watch': 'Future Watch',
  "SP's": 'Short Prints',
};
// Suffixes that mark a slice of the same insert set rather than a new set.
const INSERT_SUFFIXES = ['Rookies', 'Extended Rookies', 'Future Watch', 'Young Guns', 'Bounty'];

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const num = (s) => {
  const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const splitSet = (set) => {
  const i = set.indexOf(' - ');
  return i < 0 ? [set, ''] : [set.slice(0, i), set.slice(i + 3)];
};

function toCard(r) {
  const card = { n: r.card, p: r.name, t: teamAbbr(r.city, r.team) };
  if (r.rookie) card.rc = 1;
  if (r.auto) card.au = 1;
  if (r.mem) card.mem = 1;
  if (r.sp) card.sp = r.sp;
  const sn = num(r.serial);
  if (sn) card.sn = sn;
  return card;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  for (const [v, c] of counts) if (best === null || c > counts.get(best)) best = v;
  return best;
}

function commonWordPrefix(a, b) {
  const aw = a.split(' ');
  const bw = b.split(' ');
  let i = 0;
  while (i < aw.length && i < bw.length && aw[i] === bw[i]) i++;
  return aw.slice(0, i).join(' ');
}

/** Set name, season and id from the page title, e.g. "2025-2026 Allure Hockey Checklist - Upper Deck". */
function describe(html, fileSlug) {
  // No usable title: fall back to the page address, "2025-26-ud-series-1-checklist".
  const fromSlug = fileSlug.replace(/-/g, ' ').replace(/^(\d{4}) (\d{2,4}) /, '$1-$2 ');
  const title = (html.match(/<title>([^<]{4,})<\/title>/)?.[1] ?? fromSlug)
    .replace(/&amp;/g, '&')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/\s+-\s+Upper Deck\s*$/i, '')
    .trim();
  let season = '';
  let name = title;
  const m = title.match(/^(\d{4})(?:[-/](\d{2,4}))?\s+(.*)$/);
  if (m) {
    season = m[2] ? `${m[1]}-${m[2].slice(-2)}` : m[1];
    name = m[3];
  }
  name = name
    .replace(/\bChecklist\b/gi, '')
    .replace(/\b(Ice )?Hockey\b/gi, (all, ice) => (ice ? 'Ice' : ''))
    .replace(/\bNHL\b/g, '')
    .replace(/^(Upper Deck|UD)\s+(?=\S)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) name = 'Upper Deck';
  return { name, season, id: slug(name) + (season ? `-${season}` : '') };
}

function build(rows, log) {
  const live = rows.filter((r) => r.set && r.card && !/^\d{4} Update - /.test(r.set));

  // Group rows by subset, keeping source order.
  const subsets = new Map();
  for (const r of live) {
    if (!subsets.has(r.set)) subsets.set(r.set, []);
    subsets.get(r.set).push(r);
  }

  // ---- Base sections -------------------------------------------------
  const sections = [];
  const baseById = new Map(); // card number -> { card, section }
  for (const [set, list] of subsets) {
    if (set !== 'Base Set' && !set.startsWith('Base Set - ')) continue;
    const suffix = splitSet(set)[1];
    const label = suffix ? SECTION_ALIAS[suffix] ?? suffix : 'Base';
    let section = sections.find((s) => s.name === label);
    if (!section) {
      section = { id: slug(label), name: label, kind: 'base', cards: [] };
      sections.push(section);
    }
    for (const r of list) {
      if (baseById.has(r.card)) continue;
      const card = toCard(r);
      section.cards.push(card);
      baseById.set(r.card, { card, section });
    }
  }
  // Fold tiny sections (a lone checklist card, a handful of late rookies) into the one before.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].cards.length < 5) {
      for (const card of sections[i].cards) {
        sections[i - 1].cards.push(card);
        baseById.get(card.n).section = sections[i - 1];
      }
      sections.splice(i, 1);
    }
  }

  // ---- Parallels and variations of base cards -------------------------
  const isBaseVersion = (list) => {
    if (baseById.size === 0) return false;
    let hit = 0;
    for (const r of list) {
      const b = baseById.get(r.card);
      if (b && (!b.card.p || !r.name || b.card.p === r.name)) hit++;
    }
    return hit / list.length >= 0.9;
  };

  const parallelGroups = new Map(); // name -> rows
  const insertSubsets = new Map();
  for (const [set, list] of subsets) {
    if (set === 'Base Set' || set.startsWith('Base Set - ')) continue;
    const [head] = splitSet(set);
    const numericIds = list.every((r) => /^\d+$/.test(r.card));
    // Cards numbered past the base run that only exist as parallels (e.g. SP Authentic #200).
    const extendsBase =
      baseById.size > 0 && numericIds && / Parallel$/.test(head) && list.filter((r) => baseById.has(r.card)).length / list.length >= 0.9;
    if (isBaseVersion(list) || extendsBase) {
      const name = head.replace(/ Parallel$/, '');
      if (!parallelGroups.has(name)) parallelGroups.set(name, []);
      parallelGroups.get(name).push(...list);
    } else {
      insertSubsets.set(set, list);
    }
  }

  // Add base cards that only show up in the parallels, and fill blank names.
  for (const list of parallelGroups.values()) {
    for (const r of list) {
      const b = baseById.get(r.card);
      if (b) {
        if (!b.card.p && r.name) b.card.p = r.name;
        if (!b.card.t && r.team) b.card.t = teamAbbr(r.city, r.team);
        continue;
      }
      const target = sections[sections.length - 1];
      const card = { n: r.card, p: r.name, t: teamAbbr(r.city, r.team), po: 1 };
      if (r.rookie) card.rc = 1;
      target.cards.push(card);
      baseById.set(r.card, { card, section: target });
    }
  }
  for (const s of sections) s.cards.sort((a, b) => (num(a.n) ?? 1e9) - (num(b.n) ?? 1e9) || a.n.localeCompare(b.n));

  const usedIds = new Set();
  const uniqueId = (base) => {
    let id = base || 'x';
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  };

  const parallels = [];
  for (const [name, list] of parallelGroups) {
    const ids = [...new Set(list.map((r) => r.card))];
    const serial = num(mode(list.map((r) => r.serial)));
    const par = { id: uniqueId(slug(name)), name };
    if (serial) par.sn = serial;
    const odds = mode(list.map((r) => r.odds));
    if (odds && !/^random/i.test(odds)) par.odds = odds;
    if (list.every((r) => r.auto)) par.au = 1;
    if (list.every((r) => r.mem)) par.mem = 1;
    // Coverage: whole sections where possible, otherwise the explicit card list.
    const idSet = new Set(ids);
    const full = sections.filter((s) => s.cards.every((c) => idSet.has(c.n)));
    const fullCount = full.reduce((n, s) => n + s.cards.length, 0);
    if (fullCount === ids.length) {
      if (full.length !== sections.length) par.sections = full.map((s) => s.id);
    } else {
      par.cards = ids;
    }
    parallels.push(par);
  }

  // ---- Insert sets ----------------------------------------------------
  const insertNames = [...insertSubsets.keys()];
  const familyOf = (set) => {
    const [head, suffix] = splitSet(set);
    if (!suffix) return set;
    if (INSERT_SUFFIXES.includes(suffix) || suffix.startsWith('Future Watch Tier') || insertNames.includes(head)) return head;
    return set;
  };

  const sectionIds = new Set(sections.map((s) => s.id));
  const insertId = (family) => {
    let id = 'ins-' + slug(family);
    for (let i = 2; sectionIds.has(id); i++) id = `ins-${slug(family)}-${i}`;
    sectionIds.add(id);
    return id;
  };

  const inserts = new Map(); // family -> section
  const insertParallels = [];
  for (const [set, list] of insertSubsets) {
    const family = familyOf(set);
    if (/ Parallel$/.test(family) || / Parallel /.test(family + ' ')) {
      insertParallels.push({ family, list });
      continue;
    }
    if (!inserts.has(family)) inserts.set(family, { id: insertId(family), name: family, kind: 'insert', cards: [], parallels: [] });
    const section = inserts.get(family);
    const odds = mode(list.map((r) => r.odds));
    if (!section.odds && odds && !/^random/i.test(odds)) section.odds = odds;
    for (const r of list) {
      if (section.cards.some((c) => c.n === r.card)) continue;
      section.cards.push(toCard(r));
    }
  }

  const merged = new Map();
  for (const { family, list } of insertParallels) {
    if (!merged.has(family)) merged.set(family, []);
    merged.get(family).push(...list);
  }
  for (const [family, list] of merged) {
    let best = null;
    for (const section of inserts.values()) {
      const byId = new Map(section.cards.map((c) => [c.n, c]));
      const hit = list.filter((r) => byId.has(r.card) && byId.get(r.card).p === r.name).length;
      if (hit / list.length < 0.9) continue;
      const prefix = commonWordPrefix(section.name, family);
      if (!best || prefix.length > best.prefix.length) best = { section, prefix };
    }
    if (!best) {
      // No matching insert: keep it as its own small set so nothing is lost.
      const section = { id: insertId(family), name: family.replace(/ Parallel$/, ''), kind: 'insert', cards: [], parallels: [] };
      for (const r of list) if (!section.cards.some((c) => c.n === r.card)) section.cards.push(toCard(r));
      inserts.set(family, section);
      continue;
    }
    const short = family.slice(best.prefix.length).replace(/ Parallel$/, '').replace(/ Parallel /, ' ').trim() || family;
    let pid = slug(short) || 'parallel';
    for (let i = 2; best.section.parallels.some((p) => p.id === pid); i++) pid = `${slug(short)}-${i}`;
    const par = { id: pid, name: short };
    const serial = num(mode(list.map((r) => r.serial)));
    if (serial) par.sn = serial;
    const odds = mode(list.map((r) => r.odds));
    if (odds && !/^random/i.test(odds)) par.odds = odds;
    if (list.every((r) => r.auto)) par.au = 1;
    const ids = [...new Set(list.map((r) => r.card))];
    if (ids.length !== best.section.cards.length) par.cards = ids;
    best.section.parallels.push(par);
  }

  const all = [...sections, ...inserts.values()];
  // A product with no "Base Set" (a promo or a one-off) still needs a binder:
  // its largest set stands in as the base.
  if (sections.length === 0 && all.length > 0) {
    const largest = all.reduce((a, b) => (b.cards.length > a.cards.length ? b : a));
    largest.kind = 'base';
    parallels.push(...(largest.parallels ?? []));
    delete largest.parallels;
    all.splice(all.indexOf(largest), 1);
    all.unshift(largest);
    log.push('no base set; used the largest subset');
  }

  return { sections: all, parallels };
}

function applyOverrides(product) {
  // Optional hand-maintained fixes: { "names": { "<card number>": "Player" } }
  const path = `data/overrides/${product.id}.json`;
  if (!existsSync(path)) return;
  const overrides = JSON.parse(readFileSync(path, 'utf8'));
  for (const section of product.sections) {
    if (section.kind !== 'base') continue;
    for (const card of section.cards) if (!card.p && overrides.names?.[card.n]) card.p = overrides.names[card.n];
  }
}

// ---- Run -----------------------------------------------------------------

if (!existsSync(RAW)) {
  console.error(`No raw pages in ${RAW}. Run: node scripts/fetch-ud-hockey.mjs`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const urls = existsSync(`${RAW}/index.json`) ? JSON.parse(readFileSync(`${RAW}/index.json`, 'utf8')) : [];
const sourceFor = (fileSlug) => urls.find((u) => u.replace(/\/$/, '').endsWith('/' + fileSlug)) ?? `https://upperdeck.com/checklist/${fileSlug}/`;

const index = [];
const players = new Map(); // folded name -> set of positions in the index
const ids = new Set();
let skipped = 0;
let bytes = 0;

for (const file of readdirSync(RAW).filter((f) => f.endsWith('.html')).sort()) {
  const fileSlug = file.replace(/\.html$/, '');
  const path = RAW_OVERRIDE[fileSlug] && existsSync(RAW_OVERRIDE[fileSlug]) ? RAW_OVERRIDE[fileSlug] : `${RAW}/${file}`;
  const log = [];
  try {
    const { rows } = parseUdTable(path);
    if (rows.length < 5) throw new Error(`only ${rows.length} rows`);
    const meta = describe(readFileSync(path, 'utf8'), fileSlug);
    // The NHL index carries the odd product from another sport.
    if (/\b(golf|soccer|basketball|football|baseball)\b/i.test(meta.name)) throw new Error('not hockey');
    let id = meta.id;
    for (let i = 2; ids.has(id); i++) id = `${meta.id}-${i}`;
    ids.add(id);

    const { sections, parallels } = build(rows, log);
    const product = { id, category: 'hockey', name: meta.name, brand: 'Upper Deck', season: meta.season, source: sourceFor(fileSlug), sections, parallels };
    applyOverrides(product);
    const base = sections.filter((s) => s.kind === 'base');
    const count = base.reduce((n, s) => n + s.cards.length, 0);
    if (count === 0) throw new Error('no cards');

    const json = JSON.stringify(product);
    writeFileSync(`${OUT}/${id}.json`, json);
    bytes += json.length;
    index.push({ id, category: 'hockey', name: meta.name, brand: 'Upper Deck', season: meta.season, count });
    console.log(`${String(count).padStart(4)}  ${meta.season.padEnd(7)} ${meta.name}  [${id}]` + (log.length ? `  (${log.join('; ')})` : ''));
  } catch (e) {
    skipped++;
    console.log(`  --  skipped ${fileSlug}: ${e.message}`);
  }
}

// Newest season first, then by name.
index.sort((a, b) => b.season.localeCompare(a.season) || a.name.localeCompare(b.name));
index.forEach((entry, position) => {
  const product = JSON.parse(readFileSync(`${OUT}/${entry.id}.json`, 'utf8'));
  for (const section of product.sections) {
    if (section.kind !== 'base') continue;
    for (const card of section.cards) {
      const name = fold(card.p);
      if (!name.includes(' ') || card.p.includes('/')) continue; // Single words and multi-player cards are not useful for lookup.
      if (!players.has(name)) players.set(name, new Set());
      players.get(name).add(position);
    }
  }
});

writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
const playerIndex = {};
for (const [name, set] of [...players].sort((a, b) => a[0].localeCompare(b[0]))) playerIndex[name] = [...set];
const playersJson = JSON.stringify(playerIndex);
writeFileSync(`${OUT}/players.json`, playersJson);

console.log(`\n${index.length} sets (${skipped} skipped), ${(bytes / 1024 / 1024).toFixed(1)} MB of set files, ${players.size} players (${(playersJson.length / 1024).toFixed(0)} KB index)`);
