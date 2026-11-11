import { useState } from 'react';
import { BackButton, Screen } from '../components/Chrome';
import { shortName } from '../components/CardFace';
import { baseSections, cardKey, insertSections, useProduct, versionsFor } from '../data/catalog';
import { photoFor, usePhotoVersion } from '../lib/photos';
import { go, href, type Route } from '../lib/router';
import { addBinder, addCopy, copiesByCard, removeCopy, useCollection } from '../lib/store';
import type { Card, Copy } from '../types';
import { Loading, NotFound } from './NotFound';

/** A copy that was only ever ticked off: no photo, nothing changed on it. */
function isPlain(copy: Copy, key: string): boolean {
  return copy.condition === 'NM' && copy.protection === 'none' && !photoFor(key);
}

/**
 * The fast way to record a set you already own: every card number as a
 * button. Tap to add, tap again to take it back.
 */
export function QuickAdd({ route }: { route: Route }) {
  const state = useCollection();
  usePhotoVersion();
  const [session, setSession] = useState(0);
  const id = route.parts[1] ?? '';
  const { product, status } = useProduct(id);
  if (!product) return status === 'loading' ? <Loading what="DOWNLOADING SET…" /> : <NotFound />;

  const sections = [...baseSections(product), ...insertSections(product)];
  const section = sections.find((s) => s.id === route.query.get('s')) ?? sections[0];
  if (!section) return <NotFound />;
  const byCard = copiesByCard(state);
  const owned = section.cards.filter((c) => byCard.has(cardKey(product.id, section.id, c.n))).length;

  const tap = (card: Card) => {
    const key = cardKey(product.id, section.id, card.n);
    const copies = byCard.get(key) ?? [];
    if (copies.length === 0) {
      // A card that only exists as parallels is added as its first version.
      const version = card.po ? versionsFor(product, section, card)[0]?.id ?? 'base' : 'base';
      addCopy({ product: product.id, section: section.id, n: card.n, version });
      addBinder(product.id);
      setSession((n) => n + 1);
    } else if (copies.length === 1 && isPlain(copies[0], key)) {
      removeCopy(copies[0].id);
      setSession((n) => Math.max(0, n - 1));
    } else {
      // More than a tick is recorded here (a photo, a condition, several copies): open it instead.
      go(['card', product.id, section.id, card.n]);
    }
  };

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href(['set', product.id], section.kind === 'base' ? { s: section.id } : { s: 'inserts', i: section.id })} label="Back to binder" />
          <div>
            <h1 className="display-l">QUICK ADD</h1>
            <div className="sub">{[product.name, product.season].filter(Boolean).join(' ')} · tap a number to add it, tap again to take it back</div>
          </div>
        </div>
        <div className="set-head-count">
          <div className="display-l">
            {owned}
            <span className="dim-ink">/{section.cards.length}</span>
          </div>
          <div className="mono-strong">{session} added now</div>
        </div>
      </header>

      {sections.length > 1 ? (
        <label className="field field-inline">
          <span className="field-label">Section</span>
          <select value={section.id} onChange={(e) => go(['set', product.id, 'quick'], { s: e.target.value })}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.cards.length})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="quick" role="group" aria-label={`${section.name} cards`}>
        {section.cards.map((card) => {
          const copies = byCard.get(cardKey(product.id, section.id, card.n));
          const on = !!copies?.length;
          return (
            <button key={card.n} type="button" className={on ? 'quick-cell is-on' : 'quick-cell'} aria-pressed={on} onClick={() => tap(card)} aria-label={`${card.n} ${card.p}${on ? ', owned' : ''}`}>
              <span className="quick-no">{card.n}</span>
              <span className="quick-who">{shortName(card.p) || ' '}</span>
              {copies && copies.length > 1 ? <span className="quick-count">×{copies.length}</span> : null}
            </button>
          );
        })}
      </div>

      <p className="mono-note legend">Cards added here are recorded as base, near mint. Open a card in the binder to change its version or condition.</p>
    </Screen>
  );
}
