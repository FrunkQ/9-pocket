import { CardFace } from '../components/CardFace';
import { Screen, Segmented, Tick } from '../components/Chrome';
import { cardKey, getCard, getProduct, getSection, versionsFor } from '../data/catalog';
import { ebaySearchUrl, ebaySoldUrl } from '../lib/ebay';
import { copyValue, estimate, money, moneyTotal } from '../lib/estimate';
import { photoFor, usePhotoVersion } from '../lib/photos';
import { href, type Route } from '../lib/router';
import { addCopy, copiesByCard, removeCopy, updateCopy, useCollection } from '../lib/store';
import { CONDITIONS, PROTECTIONS } from '../types';
import { NotFound } from './NotFound';

export function CardDetail({ route }: { route: Route }) {
  const state = useCollection();
  usePhotoVersion();
  const [, productId = '', sectionId = '', n = ''] = route.parts;
  const product = getProduct(productId);
  const section = product && getSection(product, sectionId);
  const card = section && getCard(section, n);
  if (!product || !section || !card) return <NotFound />;

  const key = cardKey(product.id, section.id, card.n);
  const copies = copiesByCard(state).get(key) ?? [];
  const photo = photoFor(key);
  const versions = versionsFor(product, section, card);
  const ownedVersions = new Set(copies.map((c) => c.version));
  const value = copies.reduce((sum, c) => sum + copyValue(c), 0);
  const basePrice = card.po ? null : estimate(product, section, card);
  const site = state.settings.ebaySite;
  const backTo = section.kind === 'base' ? href(['set', product.id], { s: section.id }) : href(['set', product.id], { s: 'inserts', i: section.id });

  const facts = [`No. ${card.n}`, card.t, card.rc ? 'Rookie' : '', card.sn ? `/${card.sn}` : '', card.au ? 'Autograph' : '', card.sp ?? ''].filter(Boolean).join(' · ');
  const add = (version: string) => addCopy({ product: product.id, section: section.id, n: card.n, version });

  return (
    <Screen>
      <header className="card-head">
        <div className="card-head-top">
          <a className="back-text" href={backTo}>
            <svg aria-hidden="true" width="9" height="16" viewBox="0 0 9 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
              <path d="M7 2L2 8l5 6" />
            </svg>
            {product.name}, {section.name.toLowerCase()}
          </a>
          <span className="mono-note mono-light">{copies.length > 0 ? 'IN THE BINDER' : 'MISSING'}</span>
        </div>
        <h1 className="display-l card-name">{(card.p || 'Card').toUpperCase()}</h1>
        <div className="card-head-body">
          <div className={copies.length > 0 ? (photo ? 'card-art card-art-photo' : 'card-art') : 'card-art card-art-missing'}>
            <CardFace card={card} size="large" photo={photo?.full} />
          </div>
          <div className="card-head-info">
            <div className="sub sub-light">
              {facts}
              <br />
              {product.season} {product.brand} {product.name}
              {section.kind === 'insert' ? ` · ${section.name}` : ''}
            </div>
            <div>
              <div className="price-l">{copies.length > 0 ? moneyTotal(value) : money(basePrice)}</div>
              <div className="mono-note mono-light">{copies.length > 0 ? `your ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}, estimate` : 'estimate, base, near mint'}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="card-actions">
        <a className="btn btn-ink" href={ebaySearchUrl(site, product, section, card)} target="_blank" rel="noreferrer">
          Find on eBay
        </a>
        <a className="btn" href={ebaySoldUrl(site, product, section, card)} target="_blank" rel="noreferrer">
          Sold prices
        </a>
        {card.po ? null : (
          <button type="button" className="btn btn-red" onClick={() => add('base')}>
            {copies.length > 0 ? 'Add another copy' : 'I have this card'}
          </button>
        )}
      </div>

      {copies.map((copy, i) => (
        <section key={copy.id} className="copy" aria-label={`Copy ${i + 1}`}>
          <div className="copy-head">
            <span className="eyebrow">
              COPY {i + 1} OF {copies.length}
            </span>
            <span className="mono-note">
              added {new Date(copy.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {money(copyValue(copy) || null)}
            </span>
          </div>
          <label className="field">
            <span className="field-label">Version</span>
            <select value={copy.version} onChange={(e) => updateCopy(copy.id, { version: e.target.value })}>
              {card.po ? null : <option value="base">Base</option>}
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.sn ? ` /${v.sn}` : ''}
                </option>
              ))}
            </select>
          </label>
          <Segmented label="Condition" value={copy.condition} options={CONDITIONS} onChange={(condition) => updateCopy(copy.id, { condition })} />
          <Segmented label="Protection" value={copy.protection} options={PROTECTIONS} onChange={(protection) => updateCopy(copy.id, { protection })} />
          <button type="button" className="link-danger" onClick={() => removeCopy(copy.id)}>
            Remove this copy
          </button>
        </section>
      ))}

      {versions.length > 0 ? (
        <section className="versions" aria-labelledby="versions-title">
          <div className="versions-head">
            <h2 id="versions-title" className="eyebrow">
              VERSIONS OF THIS CARD · {ownedVersions.size} OF {versions.length + (card.po ? 0 : 1)}
            </h2>
            <span className="mono-note">~ is an estimate</span>
          </div>
          <ul className="rows">
            {card.po ? null : (
              <li className="row">
                <div className="row-main">
                  <Tick on={ownedVersions.has('base')} />
                  <span className="row-name">Base</span>
                  <span className="row-price">{money(basePrice)}</span>
                </div>
                <button type="button" className="row-buy" onClick={() => add('base')} aria-label="Add a base copy">
                  Add
                </button>
              </li>
            )}
            {versions.map((v) => (
              <li key={v.id} className="row">
                <div className="row-main">
                  <Tick on={ownedVersions.has(v.id)} />
                  <span className="row-name">
                    {v.name} {v.sn ? <small>/{v.sn}</small> : null}
                  </span>
                  <span className="row-price">{money(estimate(product, section, card, v.id))}</span>
                </div>
                <button type="button" className="row-buy" onClick={() => add(v.id)} aria-label={`Add a ${v.name} copy`}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Screen>
  );
}
