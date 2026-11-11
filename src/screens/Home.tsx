import { useRef, useState } from 'react';
import { PRODUCTS, baseSections, cardKey } from '../data/catalog';
import { BottomBar, Screen } from '../components/Chrome';
import { EBAY_SITES } from '../lib/ebay';
import { copyValue, moneyTotal } from '../lib/estimate';
import { photoCount, usePhotoVersion } from '../lib/photos';
import { href } from '../lib/router';
import { useFriends } from '../lib/share';
import { productStats } from '../lib/stats';
import { copiesByCard, downloadBackup, importBackup, isOwnPhoto, updateSettings, useCollection } from '../lib/store';
import type { Copy, Product } from '../types';

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

function Backup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<'merge' | 'replace'>('merge');
  const [message, setMessage] = useState('');
  const [withPhotos, setWithPhotos] = useState(true);
  const state = useCollection();
  usePhotoVersion();
  const photos = photoCount(isOwnPhoto);

  const pick = (mode: 'merge' | 'replace') => {
    if (mode === 'replace' && state.copies.length > 0) {
      const ok = window.confirm(`Replace the ${state.copies.length} cards saved here with the contents of a backup file? This cannot be undone.`);
      if (!ok) return;
    }
    modeRef.current = mode;
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importBackup(await file.text(), modeRef.current);
      const pictures = result.photos ? ` ${result.photos} card photos restored.` : '';
      setMessage((modeRef.current === 'replace' ? `Restored ${result.total} cards from the backup.` : `Added ${result.added} cards from the backup. ${result.total} in total.`) + pictures);
    } catch {
      setMessage('That file could not be read as a Nine Pocket backup.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section className="panel" aria-labelledby="backup-title">
      <h2 id="backup-title" className="eyebrow">
        KEEP IT SAFE
      </h2>
      <p className="panel-text">Your collection is saved in this browser only. Download a backup file to keep a copy or move it to another device.</p>
      {photos > 0 ? (
        <label className="check">
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
          <span>
            Include the {photos} card {photos === 1 ? 'photo' : 'photos'} (a bigger file)
          </span>
        </label>
      ) : null}
      <div className="row-buttons">
        <button type="button" className="btn btn-ink" onClick={() => void downloadBackup(withPhotos && photos > 0)}>
          Download backup
        </button>
        <button type="button" className="btn" onClick={() => pick('merge')}>
          Add from backup
        </button>
        <button type="button" className="btn" onClick={() => pick('replace')}>
          Replace with backup
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {message ? (
        <p className="panel-note" role="status">
          {message}
        </p>
      ) : null}
      <label className="field field-inline">
        <span className="field-label">eBay links open on</span>
        <select value={state.settings.ebaySite} onChange={(e) => updateSettings({ ebaySite: e.target.value })}>
          {EBAY_SITES.map((s) => (
            <option key={s.host} value={s.host}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

export function Home() {
  const state = useCollection();
  const friends = useFriends();
  const byCard = copiesByCard(state);
  const total = state.copies.reduce((sum, c) => sum + copyValue(c), 0);
  const started = new Set(state.copies.map((c) => c.product)).size;

  return (
    <Screen>
      <header className="home-head">
        <div className="wordmark">NINE POCKET</div>
        <div className="mono-note">saved on this device</div>
      </header>

      <div className="home-total">
        <div>
          <div className="eyebrow">EVERYTHING YOU HOLD</div>
          <div className="display-xl">{moneyTotal(total)}</div>
        </div>
        <div className="home-count">
          {state.copies.length} {state.copies.length === 1 ? 'card' : 'cards'}
          <br />
          {started} of {PRODUCTS.length} sets started
        </div>
      </div>

      <div className="sports" role="group" aria-label="Card type">
        <button type="button" className="is-on" aria-pressed="true">
          <span>Hockey</span>
          <small>{PRODUCTS.length} sets</small>
        </button>
        <button type="button" disabled>
          <span>Baseball</span>
          <small>next</small>
        </button>
        <button type="button" disabled>
          <span>Magic</span>
          <small>later</small>
        </button>
        <button type="button" disabled>
          <span>Pokémon</span>
          <small>later</small>
        </button>
      </div>

      <p className="mono-note legend">Each square is one card number. Lit means you have it. Values marked ~ are estimates.</p>

      <div className="binders">
        {PRODUCTS.map((product) => {
          const stats = productStats(product, byCard, state.copies);
          return (
            <a key={product.id} className="binder-card" href={href(['set', product.id])}>
              <div className="binder-card-top">
                <div>
                  <div className="display-m">{product.name.toUpperCase()}</div>
                  <div className="binder-card-sub">
                    {product.season} {product.brand}
                  </div>
                </div>
                <div className="display-m">
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
          );
        })}
      </div>

      <section className="panel" aria-labelledby="friends-title">
        <h2 id="friends-title" className="eyebrow">
          COMPARE WITH A FRIEND
        </h2>
        <p className="panel-text">Send your collection to someone, open theirs, and see which cards each of you could give the other.</p>
        <div className="row-buttons">
          <a className="btn btn-ink" href={href(['friends'])}>
            Share and compare{friends.length ? ` (${friends.length})` : ''}
          </a>
        </div>
      </section>

      <Backup />

      <BottomBar left={{ label: 'BINDERS', to: href([]), active: true }} right={{ label: 'SEARCH', to: href(['scan'], { mode: 'type' }) }} />
    </Screen>
  );
}
