import { useEffect, useMemo, useState } from 'react';
import { BackButton, Screen, Tick } from '../components/Chrome';
import { ensureProduct, listSets } from '../data/catalog';
import { fold } from '../lib/match';
import { go, href, type Route } from '../lib/router';
import { addBinder, binderIds, updateSettings, useCollection } from '../lib/store';
import { CATEGORIES, type Category, type SetInfo } from '../types';

const SHOWN = 120;

/** Browse every set for a kind of card and add one as a binder. */
export function AddSet({ route }: { route: Route }) {
  const state = useCollection();
  const wanted = route.query.get('c') as Category | null;
  const category = CATEGORIES.find((c) => c.id === wanted && c.ready)?.id ?? state.settings.category;
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState('');
  const have = new Set(binderIds(state));

  useEffect(() => {
    let live = true;
    setSets(null);
    setFailed(false);
    listSets(category).then(
      (list) => {
        if (!live) return;
        setSets(list);
        setFailed(list.length === 0);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [category]);

  const matches = useMemo(() => {
    const terms = fold(query).split(' ').filter(Boolean);
    if (!sets) return [];
    if (terms.length === 0) return sets;
    return sets.filter((s) => {
      const text = fold(`${s.season} ${s.brand} ${s.name} ${s.id}`);
      return terms.every((t) => text.includes(t));
    });
  }, [sets, query]);

  const add = async (set: SetInfo) => {
    setAdding(set.id);
    setProblem('');
    const product = await ensureProduct(set.id);
    setAdding('');
    if (!product) {
      setProblem(`${set.name} could not be downloaded. Check your connection and try again.`);
      return;
    }
    addBinder(set.id);
    updateSettings({ category });
    go(['set', set.id]);
  };

  const label = CATEGORIES.find((c) => c.id === category)?.label ?? '';

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href([])} label="Back to binders" />
          <div>
            <h1 className="display-l">ADD A SET</h1>
            <div className="sub">{sets ? `${sets.length} ${label} sets` : `${label} sets`}</div>
          </div>
        </div>
      </header>

      <div className="sports" role="group" aria-label="Card type">
        {CATEGORIES.map((c) => (
          <a key={c.id} className={c.id === category ? 'is-on' : c.ready ? '' : 'is-off'} aria-current={c.id === category} href={c.ready ? href(['add'], { c: c.id }) : undefined}>
            <span>{c.label}</span>
            <small>{c.ready ? 'browse' : 'later'}</small>
          </a>
        ))}
      </div>

      <label className="field">
        <span className="field-label">Find a set by name or year</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={category === 'hockey' ? 'e.g. Series 1 2025' : category === 'mtg' ? 'e.g. Bloomburrow' : 'e.g. Scarlet'} autoComplete="off" />
      </label>

      {problem ? (
        <p className="panel-note" role="status">
          {problem}
        </p>
      ) : null}
      {!sets && !failed ? <p className="mono-note">Loading the list…</p> : null}
      {failed ? <p className="panel-note">The list of sets could not be loaded. Check your connection.</p> : null}
      {sets && !failed && matches.length === 0 ? <p className="panel-note">No set matches that.</p> : null}

      <ul className="rows">
        {matches.slice(0, SHOWN).map((s) => (
          <li key={s.id} className="row">
            <button type="button" className="row-main row-button" onClick={() => void add(s)} disabled={adding !== ''}>
              <Tick on={have.has(s.id)} />
              <span className="row-name">
                {s.name}{' '}
                <small>
                  {[s.season, s.brand].filter(Boolean).join(' ')} · {s.count} cards
                </small>
              </span>
              <span className="row-price">{adding === s.id ? 'Downloading…' : have.has(s.id) ? 'Open' : 'Add'}</span>
            </button>
          </li>
        ))}
      </ul>
      {matches.length > SHOWN ? <p className="mono-note">Showing the first {SHOWN}. Type part of the name to narrow it down.</p> : null}
      <p className="mono-note legend">You can also just scan a card: if its set is not on this device yet, the scan screen offers to add it.</p>
    </Screen>
  );
}
