import type { Card, Parallel, Product, Section } from '../types';
import allure from './sets/allure-2025-26.json';
import series1 from './sets/series-1-2025-26.json';
import mvp from './sets/mvp-2026-27.json';
import spAuthentic from './sets/sp-authentic-2023-24.json';

/** Every set the app knows. Adding a set = adding its JSON file here. */
export const PRODUCTS: Product[] = [allure, series1, mvp, spAuthentic] as unknown as Product[];

const byId = new Map(PRODUCTS.map((p) => [p.id, p]));

export function getProduct(id: string): Product | undefined {
  return byId.get(id);
}

export function getSection(product: Product, sectionId: string): Section | undefined {
  return product.sections.find((s) => s.id === sectionId);
}

export function getCard(section: Section, n: string): Card | undefined {
  return section.cards.find((c) => c.n === n);
}

export function baseSections(product: Product): Section[] {
  return product.sections.filter((s) => s.kind === 'base');
}

export function insertSections(product: Product): Section[] {
  return product.sections.filter((s) => s.kind === 'insert');
}

export function baseCount(product: Product): number {
  return baseSections(product).reduce((n, s) => n + s.cards.length, 0);
}

export function cardKey(productId: string, sectionId: string, n: string): string {
  return `${productId}|${sectionId}|${n}`;
}

/** Parallels and variations that exist for this particular card. */
export function versionsFor(product: Product, section: Section, card: Card): Parallel[] {
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  return pool.filter((p) => {
    if (p.cards) return p.cards.includes(card.n);
    if (p.sections) return p.sections.includes(section.id);
    return true;
  });
}

export function versionName(product: Product, section: Section, versionId: string): string {
  if (versionId === 'base') return 'Base';
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  const p = pool.find((x) => x.id === versionId);
  if (!p) return versionId;
  return p.sn ? `${p.name} /${p.sn}` : p.name;
}

/** Binder pages: nine pockets each. */
export function pagesOf<T>(items: T[], size = 9): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export function productTitle(product: Product): string {
  return `${product.season} ${product.brand} ${product.name}`;
}
