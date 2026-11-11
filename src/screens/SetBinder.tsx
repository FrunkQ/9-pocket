import { BackButton, BottomBar, Screen } from '../components/Chrome';
import { CardFace, EmptyPocket } from '../components/CardFace';
import { baseSections, cardKey, categoryOf, insertSections, pagesOf, refreshProduct, useProduct } from '../data/catalog';
import { copyValue, moneyTotal, priceText } from '../lib/estimate';
import { photoFor, usePhotoVersion } from '../lib/photos';
import { go, href, type Route } from '../lib/router';
import { productStats } from '../lib/stats';
import { addBinder, copiesByCard, removeBinder, useCollection } from '../lib/store';
import type { Card, Copy, Product, Section } from '../types';
import { Loading, NotFound } from './NotFound';

function Pocket({ product, section, card, copies }: { product: Product; section: Section; card: Card; copies: Copy[] | undefined }) {
  const to = href(['card', product.id, section.id, card.n]);
  if (copies && copies.length > 0) {
    const value = copies.length === 1 ? priceText(product, section, card, copies[0].version, copies[0].condition) : moneyTotal(copies.reduce((sum, c) => sum + copyValue(c), 0));
    return (
      <a className="pocket" href={to} aria-label={`${card.p}, number ${card.n}, owned`}>
        <CardFace card={card} photo={photoFor(cardKey(product.id, section.id, card.n))?.thumb} />
        <span className="pocket-foot">
          <span>{value}</span>
          <span className="dim">×{copies.length}</span>
        </span>
      </a>
    );
  }
  return (
    <a className="pocket" href={to} aria-label={`${card.p}, number ${card.n}, missing`}>
      <EmptyPocket card={card} />
      <span className="pocket-foot pocket-foot-need">
        <span>{card.po ? '' : priceText(product, section, card)}</span>
        <span>need</span>
      </span>
    </a>
  );
}

export function SetBinder({ route }: { route: Route }) {
  const state = useCollection();
  usePhotoVersion();
  const id = route.parts[1] ?? '';
  const { product, status } = useProduct(id);
  if (!product) return status === 'loading' ? <Loading what="DOWNLOADING SET…" /> : <NotFound />;

  const byCard = copiesByCard(state);
  const inBinders = state.binders.includes(id) || state.copies.some((c) => c.product === id);
  const live = categoryOf(id) !== 'hockey';
  const remove = () => {
    const held = state.copies.filter((c) => c.product === id).length;
    const ok = window.confirm(held ? `Remove ${product.name} and the ${held} cards recorded in it? This cannot be undone.` : `Remove ${product.name} from your binders?`);
    if (!ok) return;
    removeBinder(id);
    go([]);
  };
  const stats = productStats(product, byCard, state.copies);
  const bases = baseSections(product);
  const inserts = insertSections(product);

  const tab = route.query.get('s') ?? bases[0].id;
  const showingInserts = tab === 'inserts';
  const insert = showingInserts ? inserts.find((s) => s.id === route.query.get('i')) ?? inserts[0] : undefined;
  const section = showingInserts ? insert : bases.find((s) => s.id === tab) ?? bases[0];
  if (!section) return <NotFound />;

  const pages = pagesOf(section.cards);
  const sectionOwned = section.cards.filter((c) => byCard.has(cardKey(product.id, section.id, c.n))).length;
  const percent = stats.total ? (stats.owned / stats.total) * 100 : 0;

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href([])} label="Back to all binders" />
          <div>
            <h1 className={product.name.length > 14 ? 'display-l is-longer' : product.name.length > 8 ? 'display-l is-long' : 'display-l'}>{product.name.toUpperCase()}</h1>
            <div className="sub">
              {[product.season, product.brand].filter(Boolean).join(' ')}
            </div>
          </div>
        </div>
        <div className="set-head-count">
          <div className="display-l">
            {stats.owned}
            <span className="dim-ink">/{stats.total}</span>
          </div>
          <div className="mono-strong">worth {moneyTotal(stats.value)}</div>
        </div>
      </header>

      <div className="progress" role="img" aria-label={`${stats.owned} of ${stats.total} cards owned`}>
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="tabs" role="tablist">
        {bases.map((s) => (
          <a key={s.id} role="tab" aria-selected={!showingInserts && s.id === section.id} className={!showingInserts && s.id === section.id ? 'is-on' : ''} href={href(['set', product.id], { s: s.id })}>
            {s.name} {/^\d+$/.test(s.cards[s.cards.length - 1].n) ? `${s.cards[0].n}–${s.cards[s.cards.length - 1].n}` : `(${s.cards.length})`}
          </a>
        ))}
        {inserts.length > 0 ? (
          <a role="tab" aria-selected={showingInserts} className={showingInserts ? 'is-on' : ''} href={href(['set', product.id], { s: 'inserts' })}>
            Inserts
          </a>
        ) : null}
      </div>

      {showingInserts && insert ? (
        <label className="field field-inline insert-pick">
          <span className="field-label">Insert set</span>
          <select value={insert.id} onChange={(e) => go(['set', product.id], { s: 'inserts', i: e.target.value })}>
            {inserts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.cards.length})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="mono-note legend">
        {section.name}: {sectionOwned} of {section.cards.length} in. Values marked ~ are estimates.
      </p>

      <details className="advanced">
        <summary>Set options: source, refresh, remove</summary>
        <p className="panel-text">
          Checklist from{' '}
          <a href={product.source} target="_blank" rel="noreferrer">
            {product.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
          </a>
          {product.fetched ? `, downloaded ${new Date(product.fetched).toLocaleDateString()}` : ''}.
        </p>
        <div className="row-buttons">
          {inBinders ? null : (
            <button type="button" className="btn btn-ink" onClick={() => addBinder(id)}>
              Add to my binders
            </button>
          )}
          {live ? (
            <button type="button" className="btn" onClick={() => void refreshProduct(id)}>
              Refresh cards and prices
            </button>
          ) : null}
          {inBinders ? (
            <button type="button" className="link-danger" onClick={remove}>
              Remove this set
            </button>
          ) : null}
        </div>
      </details>

      <div className="pages">
        {pages.map((cards, i) => {
          const inPage = cards.filter((c) => byCard.has(cardKey(product.id, section.id, c.n))).length;
          return (
            <section key={i} className="page" aria-label={`Page ${i + 1}`}>
              <div className="page-head">
                <span>
                  PAGE {i + 1} / {pages.length}
                </span>
                <span>
                  {cards[0].n}–{cards[cards.length - 1].n} · {inPage} IN
                </span>
              </div>
              <div className="page-grid">
                {cards.map((card) => (
                  <Pocket key={card.n} product={product} section={section} card={card} copies={byCard.get(cardKey(product.id, section.id, card.n))} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <BottomBar
        left={{ label: 'BINDER', to: href(['set', product.id]), active: true }}
        right={{ label: `MISSING ${stats.missing.length}`, to: href(['set', product.id, 'missing']) }}
        scanSet={product.id}
      />
    </Screen>
  );
}
