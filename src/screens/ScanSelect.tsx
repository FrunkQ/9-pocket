import { QuickGrid } from '../components/QuickGrid';
import { baseSections, cardKey, categoryOf, getProduct, insertSections, useProduct } from '../data/catalog';
import { go, href } from '../lib/router';
import { binderIds, copiesByCard, useCollection } from '../lib/store';

/**
 * The SELECT side of the scan screen: pick one of your sets and tap every
 * card you have in it. No camera, no typing.
 */
export function ScanSelect({ setId, sectionId, onChange }: { setId?: string; sectionId?: string; onChange: (delta: number) => void }) {
  const state = useCollection();
  const binders = binderIds(state);
  const chosen = setId && binders.includes(setId) ? setId : setId ?? binders.find((id) => categoryOf(id) === state.settings.category) ?? binders[0] ?? '';
  const { product, status } = useProduct(chosen);

  if (binders.length === 0 && !setId) {
    return (
      <div className="empty">
        <p className="panel-text">Add a set first, then tap the cards you have in it.</p>
        <a className="btn btn-ink" href={href(['add'])}>
          Add a set
        </a>
      </div>
    );
  }

  const sections = product ? [...baseSections(product), ...insertSections(product)] : [];
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const byCard = copiesByCard(state);
  const owned = product && section ? section.cards.filter((c) => byCard.has(cardKey(product.id, section.id, c.n))).length : 0;
  const pick = (set: string, part?: string) => go(['scan'], { mode: 'select', set, s: part });
  const ids = chosen && !binders.includes(chosen) ? [chosen, ...binders] : binders;

  return (
    <>
      <label className="field">
        <span className="field-label">Set</span>
        <select value={chosen} onChange={(e) => pick(e.target.value)}>
          {ids.map((id) => {
            const p = getProduct(id);
            return (
              <option key={id} value={id}>
                {p ? [p.name, p.season].filter(Boolean).join(' ') : id}
              </option>
            );
          })}
        </select>
      </label>

      {!product ? <p className="mono-note">{status === 'loading' ? 'Downloading the set…' : 'That set could not be loaded. Check your connection.'}</p> : null}

      {product && sections.length > 1 ? (
        <label className="field">
          <span className="field-label">Part of the set</span>
          <select value={section?.id} onChange={(e) => pick(chosen, e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.cards.length})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {product && section ? (
        <>
          <div className="select-head">
            <span className="eyebrow">TAP EVERY CARD YOU HAVE</span>
            <span className="mono-strong">
              {owned}/{section.cards.length}
            </span>
          </div>
          <QuickGrid product={product} section={section} onChange={onChange} />
          <p className="mono-note legend">Tap again to take a card back. Cards go in as base, near mint; open one in the binder to change that.</p>
          <a className="link-plain link-as-row" href={href(['add'])}>
            Add another set
          </a>
        </>
      ) : null}
    </>
  );
}
