// Turns a checklist file the user has downloaded into a set.
//
// Card makers publish checklists for people to download, but not in a form an
// app may collect by itself. So the user fetches the file and the app reads
// it: nothing is copied into the app, and the set stays on this device.
//
// Two kinds of file are understood:
//
//   PDF   A printed spreadsheet, as Topps publishes them: headings in capitals
//         ("BASE", then "BASE CARDS"), and under each heading one line per
//         card with its number, name, team and sometimes "Rookie".
//   Text  The same thing as lines of text, from a .csv, .tsv or .txt file or
//         pasted straight from a web page: one card per line with the number
//         first, columns split by tabs, commas or spaced dashes, and a line
//         without a number starting a new section.
import type { Card, Category, Parallel, Product, Section } from '../types';
import { IMPORTED } from '../data/providers';

/** One line of the file: its cells left to right, and how far in from the left edge it starts. */
interface Line {
  cells: string[];
  indent: number;
}

export interface DraftRow {
  n: string;
  p: string;
  t: string;
  rc: boolean;
}

export interface DraftSection {
  /** The heading above this section's own title, e.g. "AUTOGRAPH". Empty when there is none. */
  group: string;
  title: string;
  rows: DraftRow[];
}

export interface Draft {
  fileName: string;
  /** Guesses from the file's name, for the user to correct. */
  name: string;
  brand: string;
  season: string;
  kind: Category | null;
  sections: DraftSection[];
  cards: number;
}

// ---- Reading the file into lines -------------------------------------------

/** A PDF's text, line by line, split into cells wherever there is a wide gap. */
async function pdfLines(data: ArrayBuffer): Promise<Line[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: Line[] = [];
  let left = Infinity;
  const starts: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // Group the pieces of text into rows by their height on the page.
    const rows = new Map<number, { x: number; end: number; h: number; s: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = Math.round(item.transform[5] as number);
      let key = y;
      for (const k of rows.keys()) {
        if (Math.abs(k - y) <= 2) {
          key = k;
          break;
        }
      }
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ x, end: x + item.width, h: item.height || 10, s: item.str });
    }
    for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      items.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let end = -Infinity;
      for (const item of items) {
        const gap = item.x - end;
        const text = item.s.replace(/\s+/g, ' ');
        if (cells.length === 0 || gap > 10) {
          cells.push(text.trim());
        } else {
          // Pieces of one word (an accented letter is often its own piece) join
          // without a space; pieces a word-space apart get one.
          const last = cells.length - 1;
          cells[last] = (cells[last] + (gap > item.h * 0.18 && !cells[last].endsWith(' ') && !text.startsWith(' ') ? ' ' : '') + text).trim();
        }
        end = item.end;
      }
      left = Math.min(left, items[0].x);
      starts.push(items[0].x);
      lines.push({ cells: cells.filter(Boolean), indent: 0 });
    }
  }
  lines.forEach((line, i) => (line.indent = starts[i] - left));
  return lines.filter((line) => line.cells.length > 0);
}

/**
 * Lines of text. A table copied from a web page arrives with tabs between
 * its columns; a typed list more often has commas or a spaced dash
 * ("12 Bukayo Saka - Arsenal").
 */
function textLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const cells = raw.includes('\t') ? raw.split('\t') : raw.split(/\s+[–—-]\s+|,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      return { cells: cells.map((c) => c.trim().replace(/^"|"$/g, '').trim()).filter(Boolean), indent: 0 };
    })
    .filter((line) => line.cells.length > 0);
}

// ---- Making sense of the lines ---------------------------------------------

/** "8", "132a", "MVP-6", "81BK-AD": something that can be a card number. */
function isNumber(s: string): boolean {
  return s.length <= 14 && /^#?[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/.test(s) && (/\d/.test(s) || s.includes('-'));
}

const isShouted = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

function toRow(line: Line): DraftRow | null {
  const [first, ...rest] = line.cells;
  let n = '';
  let p = '';
  let after: string[] = [];
  if (rest.length > 0 && isNumber(first)) {
    n = first;
    p = rest[0];
    after = rest.slice(1);
  } else {
    // A number and a name run together in one cell: "12 Nikola Vucevic".
    const joined = /^(\S+?)[.)]?\s+(.+)$/.exec(first);
    if (!joined || !isNumber(joined[1]) || !/\d/.test(joined[1])) return null;
    // On its own at the left edge in capitals, that is a heading ("1981 82 TOPPS BASKETBALL").
    if (rest.length === 0 && line.indent < 20 && isShouted(first)) return null;
    n = joined[1];
    p = joined[2];
    after = rest;
  }
  const flags = after.filter((c) => /^(rookie|rc)$/i.test(c));
  const others = after.filter((c) => !/^(rookie|rc)$/i.test(c));
  return { n: n.replace(/^#/, ''), p, t: others[0] ?? '', rc: flags.length > 0 };
}

function fromLines(lines: Line[], fileName: string): Draft {
  const sections: DraftSection[] = [];
  let current: DraftSection | null = null;
  let heading = '';
  // A heading with another heading straight under it ("AUTOGRAPH", then the
  // first autograph set's title) names a group, which lasts until the next one.
  let group = '';
  let fresh = false; // A heading has been seen since the last card.
  for (const line of lines) {
    const row = toRow(line);
    if (!row) {
      const text = line.cells.join(' ');
      // Column titles ("Card #, Player, Team") are not a section.
      if (/^(card\s*(#|no|number)|number|#)\b/i.test(text) && line.cells.length > 1) continue;
      if (fresh) group = heading;
      heading = text;
      fresh = true;
      continue;
    }
    if (fresh || !current) {
      current = { group, title: heading || 'Cards', rows: [] };
      sections.push(current);
      fresh = false;
    }
    current.rows.push(row);
  }

  // A long name can run into the team's column, leaving the team stuck on the
  // end of the name. Teams seen elsewhere in the file show where to cut.
  const teams = new Map<string, number>();
  for (const s of sections) for (const r of s.rows) if (r.t) teams.set(r.t, (teams.get(r.t) ?? 0) + 1);
  const known = [...teams.entries()].filter(([, count]) => count >= 2).map(([t]) => t).sort((a, b) => b.length - a.length);
  for (const s of sections) {
    for (const r of s.rows) {
      if (r.t) continue;
      const team = known.find((t) => r.p.endsWith(' ' + t));
      if (team) {
        r.t = team;
        r.p = r.p.slice(0, -team.length).trim();
      }
    }
  }

  const guess = guessFromName(fileName);
  return { fileName, ...guess, sections: sections.filter((s) => s.rows.length > 0), cards: sections.reduce((n, s) => n + s.rows.length, 0) };
}

const KIND_WORDS: [Category, RegExp][] = [
  ['baseball', /baseball|\bmlb\b|bowman(?!.*(football|basketball))/i],
  ['basketball', /basketball|\bnba\b|\bwnba\b/i],
  ['soccer', /soccer|premier league|\buefa\b|\bmls\b|bundesliga|champions league|\bfifa\b/i],
  ['football', /football|\bnfl\b/i],
  ['hockey', /hockey|\bnhl\b/i],
];

/** "26TBSK_-_Topps_Flagship_Basketball_Checklist.xls.pdf" -> Topps, "Flagship Basketball", 2026, basketball. */
export function guessFromName(fileName: string): { name: string; brand: string; season: string; kind: Category | null } {
  let name = fileName
    .replace(/(\.(pdf|xlsx?|csv|tsv|txt))+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let season = '';
  // Topps product codes start with the year: "26TBSK - ...".
  const code = /^(\d{2})[A-Z][A-Z0-9]{2,8}\s*-\s*/.exec(name);
  if (code) {
    season = '20' + code[1];
    name = name.slice(code[0].length);
  }
  const year = /\b(19|20)\d{2}(?:[-/ ]\d{2})?\b/.exec(name);
  if (year) {
    season = year[0].replace(/[ /]/, '-');
    name = name.replace(year[0], ' ');
  }
  name = name
    .replace(/\bchecklist\b/gi, ' ')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const kind = KIND_WORDS.find(([, words]) => words.test(name))?.[0] ?? null;
  let brand = '';
  for (const maker of ['Topps', 'Bowman', 'Panini', 'Upper Deck', 'Donruss', 'Fleer', 'O-Pee-Chee', 'Leaf']) {
    if (new RegExp('\\b' + maker + '\\b', 'i').test(name)) {
      brand = maker;
      break;
    }
  }
  if (brand) name = name.replace(new RegExp('^' + brand + '\\s+', 'i'), '').trim() || name;
  return { name, brand, season, kind };
}

/** Reads a list pasted as text. Throws when it has no card lines in it. */
export function readChecklistText(text: string): Draft {
  const draft = fromLines(textLines(text), 'pasted list');
  if (draft.cards === 0) throw new Error('no cards');
  return { ...draft, name: '' };
}

/** Reads a checklist file. Throws when the file has no card lines in it. */
export async function readChecklistFile(file: File): Promise<Draft> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const lines = isPdf ? await pdfLines(await file.arrayBuffer()) : textLines(await file.text());
  const draft = fromLines(lines, file.name);
  if (draft.cards === 0) throw new Error('no cards');
  return draft;
}

// ---- Building the set -------------------------------------------------------

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const SMALL = new Set(['of', 'the', 'and', 'in', 'to', 'for', 'a', 'an', 'on', 'at']);

/** Headings come in capitals; names read better in title case. Mixed-case text is left alone. */
function titled(s: string): string {
  if (!isShouted(s)) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : /^(nba|nfl|mlb|nhl|mvp|rc|ii|iii|iv|usa|uefa|mls)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export interface ImportChoices {
  name: string;
  season: string;
  kind: Category;
}

/**
 * The set, in the app's own shape. The first large section is the base set.
 * A later section whose title starts with the base set's title and whose
 * numbers are all base numbers ("BASE CARDS BLACKOUT") is the same cards in
 * another finish, so it becomes a version of the base cards. Every other
 * section is an insert set.
 */
export function buildProduct(draft: Draft, choices: ImportChoices): Product {
  const base = draft.sections.find((s) => s.rows.length >= 20) ?? draft.sections[0];
  const baseNumbers = new Set(base.rows.map((r) => r.n));
  const baseTitle = base.title.toUpperCase();

  const toCards = (section: DraftSection): Card[] => {
    const seen = new Set<string>();
    const cards: Card[] = [];
    for (const r of section.rows) {
      if (seen.has(r.n)) continue;
      seen.add(r.n);
      const card: Card = { n: r.n, p: r.p, t: r.t };
      if (r.rc) card.rc = 1;
      // A facsimile autograph is printed on, not signed.
      if ((/AUTO/i.test(section.group) || /\bAUTO(GRAPH)?S?\b/i.test(section.title)) && !/FACSIMILE/i.test(section.title)) card.au = 1;
      if (/RELIC|MEMORABILIA/i.test(section.group) || /\bRELICS?\b/i.test(section.title)) card.mem = 1;
      cards.push(card);
    }
    return cards;
  };

  const sections: Section[] = [{ id: 'base', name: 'Base', kind: 'base', cards: toCards(base) }];
  const parallels: Parallel[] = [];
  const ids = new Set(['base']);
  const unique = (wanted: string) => {
    let id = wanted || 'part';
    for (let i = 2; ids.has(id); i++) id = `${wanted}-${i}`;
    ids.add(id);
    return id;
  };

  for (const section of draft.sections) {
    if (section === base) continue;
    const title = section.title.toUpperCase();
    const rest = title.startsWith(baseTitle + ' ') ? section.title.slice(base.title.length).trim() : '';
    if (rest && section.rows.every((r) => baseNumbers.has(r.n))) {
      const numbers = [...new Set(section.rows.map((r) => r.n))];
      const parallel: Parallel = { id: unique(slug(rest)), name: titled(rest) };
      if (numbers.length < baseNumbers.size) parallel.cards = numbers;
      parallels.push(parallel);
      continue;
    }
    sections.push({ id: unique('ins-' + slug(section.title)), name: titled(section.title), kind: 'insert', cards: toCards(section) });
  }

  const name = choices.name.trim() || draft.name || 'Loaded set';
  return {
    id: `${IMPORTED}${choices.kind}-${slug(`${choices.season} ${draft.brand} ${name}`) || 'set'}`,
    category: choices.kind,
    name,
    brand: draft.brand,
    season: choices.season.trim(),
    source: `file:${draft.fileName}`,
    fetched: new Date().toISOString(),
    sections,
    parallels,
  };
}
