import { currentRules, explain, STARS_NEXT, STARS_TOP } from '../lib/estimate';
import { formatMoney } from '../lib/currency';
import { updateSettings, useCollection } from '../lib/store';
import type { Card, Product, Section } from '../types';

// A made-up set, so the examples below can be worked out by the real rules.
const base: Section = { id: 'base', name: 'Base', kind: 'base', cards: [] };
const youngGuns: Section = { id: 'young-guns', name: 'Young Guns', kind: 'base', cards: [] };
const easy: Section = { id: 'ins-easy', name: 'An insert', kind: 'insert', odds: '1:8', cards: [] };
const hard: Section = { id: 'ins-hard', name: 'A rare insert', kind: 'insert', odds: '1:500', cards: [] };
const signed: Section = { id: 'ins-signed', name: 'Signatures', kind: 'insert', cards: [] };
const jersey: Section = { id: 'ins-jersey', name: 'Game Jersey', kind: 'insert', cards: [] };
const EXAMPLE: Product = {
  id: 'example',
  category: 'hockey',
  name: 'Example',
  brand: '',
  season: '',
  source: '',
  sections: [base, youngGuns, easy, hard, signed, jersey],
  parallels: [{ id: 'to-100', name: 'Numbered', sn: 100 }],
};
const anyone: Card = { n: '1', p: 'An Ordinary Player', t: '' };
const known: Card = { n: '2', p: STARS_NEXT[0], t: '' };
const biggest: Card = { n: '3', p: STARS_TOP[0], t: '' };

const EXAMPLES: [string, Section, Card, string?][] = [
  ['Ordinary base card', base, anyone],
  ["A well-known player's base card", base, known],
  ["One of the biggest names' base card", base, biggest],
  ['Ordinary Young Guns rookie', youngGuns, { ...anyone, rc: 1 }],
  ["One of the biggest names' Young Guns rookie", youngGuns, { ...biggest, rc: 1 }],
  ['Ordinary insert, 1 in 8 packs', easy, anyone],
  ["One of the biggest names' insert, 1 in 8 packs", easy, biggest],
  ['Ordinary insert, 1 in 500 packs', hard, anyone],
  ['Ordinary base card numbered to 100', base, anyone, 'to-100'],
  ["One of the biggest names', numbered to 100", base, biggest, 'to-100'],
  ['Ordinary autograph', signed, { ...anyone, au: 1 }],
  ["One of the biggest names' autograph", signed, { ...biggest, au: 1 }],
  ['Ordinary jersey card', jersey, anyone],
];

const title = (name: string) => name.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The rules behind every estimated value: shown, explained, and open to change. */
export function Guesstimator() {
  const state = useCollection();
  const rules = currentRules();
  const groups = [...new Set(rules.map((r) => r.group))];
  const changed = rules.filter((r) => r.value !== r.original).length;

  const set = (id: string, text: string) => {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || value < 0) return;
    updateSettings({ rules: { ...state.settings.rules, [id]: value } });
  };

  return (
    <>
      <section className="panel" aria-labelledby="guess-what">
        <h2 id="guess-what" className="eyebrow">
          WHAT THIS IS
        </h2>
        <p className="panel-text">
          Values marked ~ are guesses, not prices. Each one is worked out from the short list of rules below: what kind of card it is, how hard it is to get, and how well known the player is. Open any card to see the working for that card.
        </p>
        <p className="panel-text">The numbers are yours to change. If you know your corner of the market better than these rules do, alter them and every value in the app follows.</p>
      </section>

      <section className="panel" aria-labelledby="guess-examples">
        <h2 id="guess-examples" className="eyebrow">
          WHAT THE RULES GIVE RIGHT NOW
        </h2>
        <ul className="rows">
          {EXAMPLES.map(([label, section, card, version]) => {
            const worked = explain(EXAMPLE, section, card, version ?? 'base');
            return (
              <li key={label} className="row">
                <span className="row-main">
                  <span className="row-name">{label}</span>
                  <span className="row-price">{worked.value === null ? '' : `~${formatMoney(worked.value)}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {groups.map((group) => (
        <section key={group} className="panel" aria-label={group}>
          <h2 className="eyebrow">{group.toUpperCase()}</h2>
          {rules
            .filter((r) => r.group === group)
            .map((r) => (
              <label key={r.id} className="rule">
                <span className="rule-label">
                  {r.label}
                  {r.value !== r.original ? <small> (was {r.unit === '$' ? `$${r.original}` : `x${r.original}`})</small> : null}
                </span>
                <span className="rule-input">
                  <span aria-hidden="true">{r.unit === '$' ? '$' : 'x'}</span>
                  <input type="number" inputMode="decimal" min="0" step={r.unit === '$' ? '0.05' : '0.1'} value={r.value} onChange={(e) => set(r.id, e.target.value)} aria-label={`${r.label}, ${r.unit === '$' ? 'in US dollars' : 'multiplier'}`} />
                </span>
              </label>
            ))}
        </section>
      ))}

      <section className="panel" aria-labelledby="guess-reset">
        <h2 id="guess-reset" className="eyebrow">
          START AGAIN
        </h2>
        <p className="panel-text">{changed ? `You have changed ${changed} ${changed === 1 ? 'rule' : 'rules'}.` : 'These are the built-in rules; you have not changed any.'}</p>
        <div className="row-buttons">
          <button type="button" className="btn" disabled={!changed} onClick={() => updateSettings({ rules: {} })}>
            Put the built-in rules back
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="guess-how">
        <h2 id="guess-how" className="eyebrow">
          HOW THE BUILT-IN RULES WERE SET
        </h2>
        <p className="panel-text">
          <strong>The box test.</strong> A hobby box of 2025-26 Upper Deck Series 1 costs about $117. Value every card you would expect in a box by these rules and the total should come out at or under the price of the box. If it comes out far higher, the rules are too generous.
        </p>
        <p className="panel-text">
          <strong>Fame does not multiply everything.</strong> A star's base card is worth a few dollars at most, and a star's ordinary insert only a little more than anyone else's, because stars are in every insert set and those cards are plentiful. Fame counts for most on rookie cards and on scarce cards.
        </p>
        <p className="panel-text">
          <strong>Scarcity is a price of its own.</strong> A card numbered to 100 is worth several dollars whoever is on it, so numbered cards start from a price for the print run, not from a multiple of a ten-cent base card.
        </p>
        <p className="mono-note">Magic cards use real market prices from Scryfall, and these rules only fill in where there is none. Values are worked out in US dollars and shown in the currency you chose.</p>
        <details className="advanced">
          <summary>Who counts as well known</summary>
          <p className="panel-text">
            <strong>The biggest names:</strong> {STARS_TOP.map(title).join(', ')}.
          </p>
          <p className="panel-text">
            <strong>Well-known players:</strong> {STARS_NEXT.map(title).join(', ')}.
          </p>
          <p className="mono-note">These lists are hockey only and are fixed in the app for now. Players from sets you load from a file all count as ordinary.</p>
        </details>
      </section>
    </>
  );
}
