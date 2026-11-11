import type { Card, Copy, Product, Section } from '../types';
import { baseSections, cardKey } from '../data/catalog';
import { copyValue, estimate } from './estimate';

export interface MissingCard {
  section: Section;
  card: Card;
  price: number | null;
}

export interface ProductStats {
  owned: number;
  total: number;
  /** Estimated value of every copy held from this product (any section, any version). */
  value: number;
  /** Estimated cost of the base cards still missing. */
  toFinish: number;
  missing: MissingCard[];
}

/** Progress through the numbered base set, which is what the binder tracks. */
export function productStats(product: Product, byCard: Map<string, Copy[]>, copies: Copy[]): ProductStats {
  let owned = 0;
  let total = 0;
  let toFinish = 0;
  const missing: MissingCard[] = [];
  for (const section of baseSections(product)) {
    for (const card of section.cards) {
      total++;
      if (byCard.has(cardKey(product.id, section.id, card.n))) {
        owned++;
      } else {
        const price = card.po ? null : estimate(product, section, card);
        toFinish += price ?? 0;
        missing.push({ section, card, price });
      }
    }
  }
  let value = 0;
  for (const c of copies) if (c.product === product.id) value += copyValue(c);
  return { owned, total, value, toFinish, missing };
}
