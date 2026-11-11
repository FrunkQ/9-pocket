// Links out to eBay searches. No eBay account or API is involved: these are
// ordinary search pages opened in a new tab.
import type { Card, Product, Section } from '../types';
import { isOther, otherLabel, versionName } from '../data/catalog';

export const EBAY_SITES = [
  { host: 'www.ebay.com', label: 'eBay US' },
  { host: 'www.ebay.ca', label: 'eBay Canada' },
  { host: 'www.ebay.co.uk', label: 'eBay UK' },
];

function searchTerms(product: Product, section: Section, card: Card, versionId: string): string {
  const terms = [product.season, product.brand, product.name];
  // Subset names help find a hockey card; for card games the number is enough.
  if (product.category === 'hockey' && section.id !== 'base') terms.push(section.name);
  terms.push(card.p, `#${card.n}`);
  if (isOther(versionId)) terms.push(otherLabel(versionId).trim());
  else if (versionId !== 'base') terms.push(versionName(product, section, versionId).replace(/ \/\d+$/, ''));
  return terms.filter(Boolean).join(' ');
}

/** Cards for sale right now. */
export function ebaySearchUrl(site: string, product: Product, section: Section, card: Card, versionId = 'base'): string {
  const q = new URLSearchParams({ _nkw: searchTerms(product, section, card, versionId), _sacat: '0' });
  return `https://${site}/sch/i.html?${q}`;
}

/** What the card has actually sold for recently. */
export function ebaySoldUrl(site: string, product: Product, section: Section, card: Card, versionId = 'base'): string {
  const q = new URLSearchParams({ _nkw: searchTerms(product, section, card, versionId), _sacat: '0', LH_Sold: '1', LH_Complete: '1' });
  return `https://${site}/sch/i.html?${q}`;
}
