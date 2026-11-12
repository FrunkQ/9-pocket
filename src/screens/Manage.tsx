import { useState } from 'react';
import { BackButton, Screen, Segmented } from '../components/Chrome';
import { categoryOf, getProduct, useCatalogVersion } from '../data/catalog';
import { go, href, type Route } from '../lib/router';
import { binderIds, removeBinder, updateSetCopies, useCollection } from '../lib/store';
import { CATEGORIES, CONDITIONS, PROTECTIONS, type Condition, type Copy, type Protection } from '../types';

/** "20 Sleeved, 3 Top loader": how a set's cards are spread over the choices. */
function spread<T extends string>(copies: Copy[], pick: (c: Copy) => T, options: { id: T; label: string }[]): string {
  return options
    .map((o) => ({ label: o.label, n: copies.filter((c) => pick(c) === o.id).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.label.toLowerCase()}`)
    .join(', ');
}

/** The value every card shares, or '' when they differ (so no choice shows as selected). */
function shared<T extends string>(copies: Copy[], pick: (c: Copy) => T): T | '' {
  const first = copies[0] ? pick(copies[0]) : '';
  return copies.every((c) => pick(c) === first) ? first : '';
}

/** Changes to a whole set at once: how its cards are protected, their condition, or removing it. */
function ManageSet({ id }: { id: string }) {
  const state = useCollection();
  useCatalogVersion();
  const [done, setDone] = useState('');
  const product = getProduct(id);
  const name = product?.name ?? 'this set';
  const copies = state.copies.filter((c) => c.product === id);
  const cards = `${copies.length} ${copies.length === 1 ? 'card' : 'cards'}`;

  const protect = (protection: Protection) => {
    const label = PROTECTIONS.find((p) => p.id === protection)?.label ?? protection;
    if (!window.confirm(`Mark all ${cards} in ${name} as "${label}"?`)) return;
    updateSetCopies(id, { protection });
    setDone(`All ${cards} are now marked ${label.toLowerCase()}.`);
  };
  const grade = (condition: Condition) => {
    const label = CONDITIONS.find((c) => c.id === condition)?.label ?? condition;
    if (!window.confirm(`Mark all ${cards} in ${name} as "${label}"? This replaces the condition recorded for each card.`)) return;
    updateSetCopies(id, { condition });
    setDone(`All ${cards} are now marked ${label.toLowerCase()}.`);
  };
  const remove = () => {
    const ok = window.confirm(copies.length ? `Remove ${name} and the ${cards} recorded in it? This cannot be undone.` : `Remove ${name} from your sets?`);
    if (!ok) return;
    removeBinder(id);
    go(['manage']);
  };

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href(['manage'])} label="Back to manage sets" />
          <div>
            <h1 className={name.length > 14 ? 'display-l is-longer' : name.length > 8 ? 'display-l is-long' : 'display-l'}>{name.toUpperCase()}</h1>
            <div className="sub">
              {[product?.season, product?.brand].filter(Boolean).join(' ')} · {cards} recorded
            </div>
          </div>
        </div>
      </header>

      {done ? (
        <p className="scan-added" role="status">
          {done}
        </p>
      ) : null}

      {copies.length > 0 ? (
        <>
          <section className="panel" aria-labelledby="protect-title">
            <h2 id="protect-title" className="eyebrow">
              PROTECT THE WHOLE SET
            </h2>
            <p className="panel-text">Sleeved the lot, or moved them to top loaders? Pick how every card in this set is kept. Now: {spread(copies, (c) => c.protection, PROTECTIONS)}.</p>
            <Segmented label="Mark every card as" value={shared(copies, (c) => c.protection) as Protection} options={PROTECTIONS} onChange={protect} />
          </section>

          <section className="panel" aria-labelledby="grade-title">
            <h2 id="grade-title" className="eyebrow">
              REGRADE THE WHOLE SET
            </h2>
            <p className="panel-text">Sets every card in this set to one condition, replacing what each card has now: {spread(copies, (c) => c.condition, CONDITIONS)}.</p>
            <Segmented label="Mark every card as" value={shared(copies, (c) => c.condition) as Condition} options={CONDITIONS} onChange={grade} />
          </section>
        </>
      ) : (
        <p className="panel-note">No cards are recorded in this set yet, so there is nothing to protect or regrade.</p>
      )}

      <section className="panel" aria-labelledby="remove-title">
        <h2 id="remove-title" className="eyebrow">
          REMOVE THE SET
        </h2>
        <p className="panel-text">Sold it, or added it by mistake? This takes the set off your home screen{copies.length ? ` and deletes the ${cards} recorded in it` : ''}.</p>
        <div className="row-buttons">
          <button type="button" className="btn btn-remove" onClick={remove}>
            Remove {name}
          </button>
          <a className="btn" href={href(['set', id])}>
            Open the set instead
          </a>
        </div>
      </section>
    </Screen>
  );
}

/** Every set the user has, to pick one to change as a whole. Reached from the home screen's menu. */
export function Manage({ route }: { route: Route }) {
  const state = useCollection();
  useCatalogVersion();
  const id = route.parts[1];
  if (id) return <ManageSet key={id} id={id} />;
  const ids = binderIds(state);

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href([])} label="Back to binders" />
          <div>
            <h1 className="display-l">MANAGE SETS</h1>
            <div className="sub">Sleeve, regrade or remove a whole set</div>
          </div>
        </div>
      </header>

      {ids.length === 0 ? <p className="panel-note">You have no sets yet. Add one from the home screen.</p> : <p className="mono-note legend">Pick a set. Nothing changes until you choose something on the next screen and confirm it.</p>}

      <ul className="rows">
        {ids.map((setId) => {
          const product = getProduct(setId);
          const count = state.copies.filter((c) => c.product === setId).length;
          const kind = CATEGORIES.find((c) => c.id === categoryOf(setId))?.label ?? '';
          return (
            <li key={setId} className="row">
              <a className="row-main row-button" href={href(['manage', setId])}>
                <span className="row-name">
                  {product?.name ?? 'Set not downloaded'}{' '}
                  <small>{[product?.season, product?.brand, kind].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="row-price">
                  {count} {count === 1 ? 'card' : 'cards'}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className="row-buttons">
        <a className="btn btn-ink" href={href([])}>
          Done
        </a>
      </div>
    </Screen>
  );
}
