import { shortName } from './CardFace';
import { cardKey, versionsFor } from '../data/catalog';
import { photoFor, usePhotoVersion } from '../lib/photos';
import { go } from '../lib/router';
import { addBinder, addCopy, copiesByCard, removeCopy, useCollection } from '../lib/store';
import type { Card, Copy, Product, Section } from '../types';

/** A copy that was only ever ticked off: no photo, nothing changed on it. */
function isPlain(copy: Copy, key: string): boolean {
  return copy.version === 'base' && copy.condition === 'NM' && copy.protection === 'none' && !photoFor(key);
}

/**
 * Every card number in a section as a button. Tap to add, tap again to take
 * it back: the fast way to record cards you already own.
 * `onChange` is told +1 or -1 so the caller can keep a running count.
 */
export function QuickGrid({ product, section, onChange }: { product: Product; section: Section; onChange?: (delta: number) => void }) {
  const state = useCollection();
  usePhotoVersion();
  const byCard = copiesByCard(state);

  const tap = (card: Card) => {
    const key = cardKey(product.id, section.id, card.n);
    const copies = byCard.get(key) ?? [];
    if (copies.length === 0) {
      // A card that only exists as parallels is added as its first version.
      const version = card.po ? versionsFor(product, section, card)[0]?.id ?? 'base' : 'base';
      addCopy({ product: product.id, section: section.id, n: card.n, version });
      addBinder(product.id);
      onChange?.(1);
    } else if (copies.length === 1 && (isPlain(copies[0], key) || (card.po === 1 && !photoFor(key)))) {
      removeCopy(copies[0].id);
      onChange?.(-1);
    } else {
      // More than a tick is recorded here (a photo, a version, several copies): open it instead.
      go(['card', product.id, section.id, card.n]);
    }
  };

  return (
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
  );
}
