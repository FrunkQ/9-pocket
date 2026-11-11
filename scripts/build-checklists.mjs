// Turns the raw Upper Deck checklist pages in data/raw into the compact JSON
// the app ships with (src/data/sets/*.json).
//
//   node scripts/build-checklists.mjs
//
// Each product becomes: base sections (the numbered set you put in a binder),
// the parallels that exist for those base cards, and insert sets with their
// own parallels.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { parseUdTable } from './lib/ud-table.mjs';
import { teamAbbr } from './lib/teams.mjs';

const PRODUCTS = [
  {
    id: 'allure-2025-26',
    file: 'allure-ud.html',
    name: 'Allure',
    brand: 'Upper Deck',
    season: '2025-26',
    source: 'https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/',
  },
  {
    id: 'series-1-2025-26',
    file: 'series1-ud.html',
    name: 'Series 1',
    brand: 'Upper Deck',
    season: '2025-26',
    source: 'https://upperdeck.com/checklist/2025-26-ud-series-1-checklist/',
  },
  {
    id: 'mvp-2026-27',
    file: 'mvp-ud.html',
    name: 'MVP',
    brand: 'Upper Deck',
    season: '2026-27',
    source: 'https://upperdeck.com/checklist/2026-27-mvp-checklist/',
  },
  {
    id: 'sp-authentic-2023-24',
    file: 'spa-ud.html',
    name: 'SP Authentic',
    brand: 'Upper Deck',
    season: '2023-24',
    source: 'https://upperdeck.com/checklist/2023-24-sp-authentic-checklist/',
  },
];

// "Base Set - <suffix>" becomes a binder section with this label.
const SECTION_ALIAS = {
  'Autographed Future Watch': 'Future Watch',
  "SP's": 'Short Prints',
};
// Suffixes that mark a slice of the same insert set rather than a new set.
const INSERT_SUFFIXES = ['Rookies', 'Extended Rookies', 'Future Watch', 'Young Guns', 'Bounty'];

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

function build(product) {
  const { rows } = parseUdTable(`data/raw/${product.file}`);
  const log = [];
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
      log.push(`folded "${sections[i].name}" (${sections[i].cards.length}) into "${sections[i - 1].name}"`);
      sections.splice(i, 1);
    }
  }

  // ---- Parallels and variations of base cards -------------------------
  const isBaseVersion = (list) => {
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
      numericIds && / Parallel$/.test(head) && list.filter((r) => baseById.has(r.card)).length / list.length >= 0.9;
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
      log.push(`#${r.card} ${r.name} exists only as parallels; added to "${target.name}"`);
    }
  }
  for (const s of sections) s.cards.sort((a, b) => (num(a.n) ?? 1e9) - (num(b.n) ?? 1e9) || a.n.localeCompare(b.n));

  const parallels = [];
  for (const [name, list] of parallelGroups) {
    const ids = [...new Set(list.map((r) => r.card))];
    const serial = num(mode(list.map((r) => r.serial)));
    const par = { id: slug(name), name };
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

  const inserts = new Map(); // family -> section
  const insertParallels = [];
  for (const [set, list] of insertSubsets) {
    const family = familyOf(set);
    if (/ Parallel$/.test(family) || / Parallel /.test(family + ' ')) {
      insertParallels.push({ family, list });
      continue;
    }
    if (!inserts.has(family)) inserts.set(family, { id: 'ins-' + slug(family), name: family, kind: 'insert', cards: [], parallels: [] });
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
      const section = { id: 'ins-' + slug(family), name: family.replace(/ Parallel$/, ''), kind: 'insert', cards: [], parallels: [] };
      for (const r of list) if (!section.cards.some((c) => c.n === r.card)) section.cards.push(toCard(r));
      inserts.set(family, section);
      log.push(`insert parallel "${family}" has no parent; kept as its own set`);
      continue;
    }
    const short = family.slice(best.prefix.length).replace(/ Parallel$/, '').replace(/ Parallel /, ' ').trim() || family;
    const par = { id: slug(short), name: short };
    const serial = num(mode(list.map((r) => r.serial)));
    if (serial) par.sn = serial;
    const odds = mode(list.map((r) => r.odds));
    if (odds && !/^random/i.test(odds)) par.odds = odds;
    if (list.every((r) => r.auto)) par.au = 1;
    const ids = [...new Set(list.map((r) => r.card))];
    if (ids.length !== best.section.cards.length) par.cards = ids;
    best.section.parallels.push(par);
  }

  const blank = sections.flatMap((s) => s.cards).filter((c) => !c.p);
  if (blank.length) log.push(`${blank.length} base cards have no player name in the source (${blank[0].n}..${blank[blank.length - 1].n})`);

  // Optional hand-maintained fixes: { "names": { "<card number>": "Player" } }
  const overridePath = `data/overrides/${product.id}.json`;
  if (existsSync(overridePath)) {
    const overrides = JSON.parse(readFileSync(overridePath, 'utf8'));
    let applied = 0;
    for (const [n, p] of Object.entries(overrides.names ?? {})) {
      const b = baseById.get(n);
      if (b && !b.card.p) {
        b.card.p = p;
        applied++;
      }
    }
    log.push(`applied ${applied} name overrides from ${overridePath}`);
  }

  return {
    data: {
      id: product.id,
      name: product.name,
      brand: product.brand,
      season: product.season,
      sport: 'hockey',
      source: product.source,
      sections: [...sections, ...inserts.values()],
      parallels,
    },
    log,
  };
}

mkdirSync('src/data/sets', { recursive: true });
for (const product of PRODUCTS) {
  const { data, log } = build(product);
  const path = `src/data/sets/${product.id}.json`;
  const json = JSON.stringify(data);
  writeFileSync(path, json);
  const base = data.sections.filter((s) => s.kind === 'base');
  const ins = data.sections.filter((s) => s.kind === 'insert');
  console.log(`\n${product.season} ${product.name} -> ${path} (${(json.length / 1024).toFixed(0)} KB)`);
  console.log('  base: ' + base.map((s) => `${s.name} ${s.cards.length} [${s.cards[0].n}..${s.cards[s.cards.length - 1].n}]`).join(', '));
  console.log('  parallels: ' + data.parallels.map((p) => p.name + (p.sn ? ' /' + p.sn : '') + (p.cards ? ` (${p.cards.length})` : p.sections ? ` {${p.sections}}` : '')).join(', '));
  console.log(`  inserts: ${ins.length} sets, ${ins.reduce((n, s) => n + s.cards.length, 0)} cards: ` + ins.map((s) => `${s.name} ${s.cards.length}${s.parallels.length ? '+' + s.parallels.length + 'p' : ''}`).join(', '));
  for (const line of log) console.log('  note: ' + line);
}
