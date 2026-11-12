import { useState } from 'react';
import { baseSections, cardKey, categoryOf, getProduct, useCatalogVersion } from '../data/catalog';
import { BottomBar, Screen } from '../components/Chrome';
import { copyValue, moneyTotal } from '../lib/estimate';
import { useInstall } from '../lib/install';
import { href } from '../lib/router';
import { useFriends } from '../lib/share';
import { productStats } from '../lib/stats';
import { binderIds, copiesByCard, shownKinds, updateSettings, useCollection } from '../lib/store';
import { CATEGORIES, type Copy, type Product } from '../types';

/** One square per base card, lit when owned: shows at a glance which numbers are in. */
function Fingerprint({ product, byCard }: { product: Product; byCard: Map<string, Copy[]> }) {
  const cells: boolean[] = [];
  for (const section of baseSections(product)) {
    for (const card of section.cards) cells.push(byCard.has(cardKey(product.id, section.id, card.n)));
  }
  const owned = cells.filter(Boolean).length;
  return (
    <div className="fingerprint" role="img" aria-label={`${owned} of ${cells.length} cards owned`}>
      {cells.map((on, i) => (
        <span key={i} className={on ? 'is-on' : ''} />
      ))}
    </div>
  );
}

export function Home() {
  const state = useCollection();
  useCatalogVersion();
  const byCard = copiesByCard(state);
  const total = state.copies.reduce((sum, c) => sum + copyValue(c), 0);
  const all = binderIds(state);
  const shown = shownKinds(state.settings);
  const category = shown.includes(state.settings.category) ? state.settings.category : shown[0];
  const fromFiles = CATEGORIES.find((c) => c.id === category)?.source === 'files';
  const mine = all.filter((id) => categoryOf(id) === category);
  const label = CATEGORIES.find((c) => c.id === category)?.label ?? '';
  const [menu, setMenu] = useState(false);
  const friends = useFriends();
  const install = useInstall();
  const canInstall = !install.installed && (install.canPrompt || install.ios);


  return (
    <Screen>
      <header className="home-head">
        <div className="wordmark">NINE POCKET</div>
        <button type="button" className="burger" aria-label="Menu" aria-expanded={menu} aria-controls="home-menu" onClick={() => setMenu((open) => !open)}>
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
            {menu ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
          </svg>
        </button>
      </header>

      {menu ? (
        <nav id="home-menu" className="menu" aria-label="More">
          <a href={href(['friends'])}>
            SHARE WITH A FRIEND
            <small>{friends.length ? `Compare collections · ${friends.length} saved` : 'Send your collection and compare'}</small>
          </a>
          <a href={href(['settings', 'types'])}>
            ADD OR HIDE CARD TYPES
            <small>Baseball, football and the rest</small>
          </a>
          {all.length > 0 ? (
            <a href={href(['manage'])}>
              MANAGE SETS
              <small>Sleeve, regrade or remove a whole set</small>
            </a>
          ) : null}
          <a href={href(['settings', 'backup'])}>
            BACKUP FILES
            <small>Save a copy, restore one, move to another device</small>
          </a>
          <a href={href(['settings', 'values'])}>
            EBAY AND CURRENCY
            <small>Which eBay site, and what values are shown in</small>
          </a>
          {canInstall ? (
            <a href={href(['settings', 'install'])}>
              INSTALL THE APP
              <small>Put it on your home screen</small>
            </a>
          ) : null}
          <a href={href(['settings', 'about'])}>
            ABOUT
            <small>What this is, who to ask, where the code lives</small>
          </a>
          <p className="mono-note version">Version {__BUILD__}</p>
        </nav>
      ) : null}

      <div className="home-total">
        <div>
          <div className="eyebrow">EVERYTHING YOU HOLD</div>
          <div className="display-xl">{moneyTotal(total)}</div>
        </div>
        <div className="home-count">
          {state.copies.length} {state.copies.length === 1 ? 'card' : 'cards'}
          <br />
          {all.length} {all.length === 1 ? 'set' : 'sets'}
        </div>
      </div>

      <div className="sports" role="group" aria-label="Card type">
        {CATEGORIES.filter((c) => shown.includes(c.id)).map((c) => {
          const n = all.filter((id) => categoryOf(id) === c.id).length;
          return (
            <button key={c.id} type="button" className={c.id === category ? 'is-on' : ''} aria-pressed={c.id === category} onClick={() => updateSettings({ category: c.id })}>
              <span>{c.label}</span>
              <small>
                {n} {n === 1 ? 'set' : 'sets'}
              </small>
            </button>
          );
        })}
      </div>

      {mine.length > 0 ? <p className="mono-note legend">Each square is one card number. Lit means you have it. Values marked ~ are estimates.</p> : null}

      <div className="binders">
        {mine.map((id) => {
          const product = getProduct(id);
          if (!product) {
            return (
              <div key={id} className="binder-wrap">
                <a className="binder-card binder-card-off" href={href(['set', id])}>
                  <div className="binder-card-sub">This set has not downloaded yet. Open it when you are online.</div>
                </a>
              </div>
            );
          }
          const stats = productStats(product, byCard, state.copies);
          return (
            <div key={id} className="binder-wrap">
            <a className="binder-card" href={href(['set', id])}>
              <div className="binder-card-top">
                <div>
                  <div className="display-m">{product.name.toUpperCase()}</div>
                  <div className="binder-card-sub">{[product.season, product.brand].filter(Boolean).join(' ')}</div>
                </div>
                <div className="display-m binder-card-count">
                  {stats.owned}
                  <span className="dim">/{stats.total}</span>
                </div>
              </div>
              <Fingerprint product={product} byCard={byCard} />
              <div className="binder-card-foot">
                <span>worth {moneyTotal(stats.value)}</span>
                <span className="dim">{stats.missing.length === 0 ? 'complete' : `${moneyTotal(stats.toFinish)} to finish`}</span>
              </div>
            </a>
            </div>
          );
        })}
        <a className="binder-add" href={href(['add'], { c: category })}>
          <span className="display-m">ADD A SET</span>
          <span>
            {fromFiles
              ? `${label} sets come from checklist files you download. Load one here.`
              : mine.length === 0
                ? `No ${label} sets yet. Pick one from the list, or scan a card and the app will find its set.`
                : `Browse every ${label} set`}
          </span>
        </a>
      </div>


      <BottomBar left={{ label: 'BINDERS', to: href([]), active: true }} right={{ label: 'SEARCH', to: href(['scan'], { mode: 'type' }) }} />
    </Screen>
  );
}
