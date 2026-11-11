import { useState } from 'react';
import { BackButton, BottomBar, Screen, Tick } from '../components/Chrome';
import { getProduct, productTitle } from '../data/catalog';
import { ebaySearchUrl } from '../lib/ebay';
import { money, moneyTotal } from '../lib/estimate';
import { href, type Route } from '../lib/router';
import { productStats, type MissingCard } from '../lib/stats';
import { copiesByCard, useCollection } from '../lib/store';
import { NotFound } from './NotFound';

type Sort = 'number' | 'cheapest' | 'team';

function sorted(list: MissingCard[], sort: Sort): MissingCard[] {
  if (sort === 'number') return list;
  const copy = [...list];
  if (sort === 'cheapest') copy.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else copy.sort((a, b) => a.card.t.localeCompare(b.card.t));
  return copy;
}

export function Missing({ route }: { route: Route }) {
  const state = useCollection();
  const [sort, setSort] = useState<Sort>('number');
  const [shared, setShared] = useState('');
  const product = getProduct(route.parts[1] ?? '');
  if (!product) return <NotFound />;

  const stats = productStats(product, copiesByCard(state), state.copies);
  const list = sorted(stats.missing, sort);

  const bySection = new Map<string, number>();
  for (const m of stats.missing) bySection.set(m.section.name, (bySection.get(m.section.name) ?? 0) + 1);
  const breakdown = [...bySection].map(([name, n]) => `${n} ${name.toLowerCase()}`).join(', ');

  const share = async () => {
    const text = `${productTitle(product)} — cards I still need (${stats.missing.length}):\n` + stats.missing.map((m) => `#${m.card.n} ${m.card.p}`).join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: `${product.name} want list`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShared('Want list copied.');
    } catch {
      setShared('');
    }
  };

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href(['set', product.id])} label="Back to binder" />
          <div>
            <h1 className="display-l">MISSING</h1>
            <div className="sub">
              {product.name} {product.season} · {stats.missing.length} of {stats.total} to go
            </div>
          </div>
        </div>
      </header>

      <div className="hero">
        <div>
          <div className="eyebrow eyebrow-light">FINISH THE SET FOR ABOUT</div>
          <div className="display-xl">{stats.missing.length === 0 ? 'DONE' : moneyTotal(stats.toFinish)}</div>
          <div className="hero-sub">{stats.missing.length === 0 ? 'Every base card is in the binder.' : `${breakdown}. Every price is an estimate.`}</div>
        </div>
        {stats.missing.length > 0 ? (
          <button type="button" className="btn btn-light" onClick={() => void share()}>
            Share list
          </button>
        ) : null}
      </div>
      {shared ? (
        <p className="panel-note" role="status">
          {shared}
        </p>
      ) : null}

      <div className="chips" role="group" aria-label="Sort">
        {(
          [
            ['number', 'By number'],
            ['cheapest', 'Cheapest first'],
            ['team', 'By team'],
          ] as [Sort, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={sort === id ? 'chip is-on' : 'chip'} aria-pressed={sort === id} onClick={() => setSort(id)}>
            {label}
          </button>
        ))}
      </div>

      <ul className="rows">
        {list.map(({ section, card, price }) => (
          <li key={section.id + card.n} className="row">
            <a className="row-main" href={href(['card', product.id, section.id, card.n])}>
              <Tick on={false} />
              <span className="row-no">{card.n}</span>
              <span className="row-name">
                {card.p || 'Card'} <small>{card.t}</small>
              </span>
              <span className="row-price">{price === null ? '' : money(price)}</span>
            </a>
            <a className="row-buy" href={ebaySearchUrl(state.settings.ebaySite, product, section, card)} target="_blank" rel="noreferrer" aria-label={`Find ${card.p} number ${card.n} on eBay`}>
              eBay
            </a>
          </li>
        ))}
      </ul>

      <BottomBar
        left={{ label: 'BINDER', to: href(['set', product.id]) }}
        right={{ label: `MISSING ${stats.missing.length}`, to: href(['set', product.id, 'missing']), active: true }}
        scanSet={product.id}
      />
    </Screen>
  );
}
