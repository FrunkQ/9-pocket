// Display currency. Every value in the app is worked out in US dollars (that
// is what the price sources and the estimates use) and converted only when it
// is shown.
//
// Rates come from the European Central Bank's daily reference rates via the
// free Frankfurter API, are kept for a day, and fall back to the built-in
// figures below when the app has never been online.
import { useSyncExternalStore } from 'react';

export const CURRENCIES = [
  { code: 'USD', label: 'US dollars', symbol: '$' },
  { code: 'CAD', label: 'Canadian dollars', symbol: 'CA$' },
  { code: 'GBP', label: 'Pounds', symbol: '£' },
  { code: 'EUR', label: 'Euros', symbol: '€' },
  { code: 'AUD', label: 'Australian dollars', symbol: 'A$' },
];

interface Rates {
  /** The day the rates are for, YYYY-MM-DD. */
  date: string;
  /** When they were fetched (ms since epoch); 0 for the built-in figures. */
  fetched: number;
  /** Units of each currency per US dollar. */
  rates: Record<string, number>;
}

const BUILT_IN: Rates = { date: '2026-11-11', fetched: 0, rates: { USD: 1, CAD: 1.4235, GBP: 0.75149, EUR: 0.89871, AUD: 1.4579 } };
const STORAGE_KEY = 'ninepocket.rates';
const DAY_MS = 24 * 60 * 60 * 1000;

function stored(): Rates {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Rates | null;
    if (v && typeof v.date === 'string' && v.rates && typeof v.rates.USD === 'number') return v;
  } catch {
    // Fall through to the built-in rates.
  }
  return BUILT_IN;
}

let code = 'USD';
let current: Rates = stored();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** Re-renders the caller when the currency or its rates change. */
export function useCurrencyVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** Called by the collection store whenever the setting is read or changed. */
export function setDisplayCurrency(next: string) {
  const valid = CURRENCIES.some((c) => c.code === next) ? next : 'USD';
  if (valid === code) return;
  code = valid;
  changed();
  if (code !== 'USD') void refreshRates();
}

let refreshing = false;

/** Fetches today's rates if the stored ones are more than a day old. */
export async function refreshRates(): Promise<void> {
  if (refreshing || Date.now() - current.fetched < DAY_MS) return;
  refreshing = true;
  try {
    const symbols = CURRENCIES.map((c) => c.code).filter((c) => c !== 'USD').join(',');
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols}`);
    if (!res.ok) return;
    const data = (await res.json()) as { date: string; rates: Record<string, number> };
    if (!data.rates || typeof data.date !== 'string') return;
    current = { date: data.date, fetched: Date.now(), rates: { USD: 1, ...data.rates } };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Keep them for this session only.
    }
    changed();
  } catch {
    // Offline: carry on with what we have.
  } finally {
    refreshing = false;
  }
}

export function displayCurrency(): string {
  return code;
}

/** "rates from 11 Nov 2026" or "built-in rates from ..." for the settings note. */
export function ratesNote(): string {
  const day = new Date(`${current.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return current.fetched ? `European Central Bank rates for ${day}` : `built-in rates from ${day}; they update when you are online`;
}

/** A US-dollar amount in the display currency, e.g. "£0.56". */
export function formatMoney(usd: number): string {
  const currency = CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
  const value = usd * (current.rates[code] ?? 1);
  return currency.symbol + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
