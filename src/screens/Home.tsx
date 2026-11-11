import { useRef, useState } from 'react';
import { baseSections, cardKey, categoryOf, getProduct, useCatalogVersion } from '../data/catalog';
import { BottomBar, Screen } from '../components/Chrome';
import { EBAY_SITES } from '../lib/ebay';
import { copyValue, moneyTotal } from '../lib/estimate';
import { promptInstall, useInstall } from '../lib/install';
import { photoCount, usePhotoVersion } from '../lib/photos';
import { href } from '../lib/router';
import { useFriends } from '../lib/share';
import { productStats } from '../lib/stats';
import { binderIds, copiesByCard, downloadBackup, eraseEverything, importBackup, isOwnPhoto, updateSettings, useCollection } from '../lib/store';
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

  const erase = () => {
    const ok = window.confirm('Erase everything Nine Pocket has saved on this device: every card, photo, set and friend? This cannot be undone.');
    if (ok) void eraseEverything();
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
      <details className="advanced">
        <summary>Advanced</summary>
        <p className="panel-text">For testing. Removes every card, photo, downloaded set and friend from this device and starts the app fresh.</p>
        <button type="button" className="link-danger" onClick={erase}>
          Erase everything on this device
        </button>
      </details>
    </section>
  );
}

/** Offers to put the app on the home screen, where the browser allows it. */
function Install() {
  const install = useInstall();
  const state = useCollection();
  if (install.installed || (!install.canPrompt && !install.ios)) return null;
  return (
    <section className="panel" aria-labelledby="install-title">
      <h2 id="install-title" className="eyebrow">
        INSTALL THE APP
      </h2>
      {install.canPrompt ? (
        <>
          <p className="panel-text">Put Nine Pocket on your home screen. It opens full-screen and works without a connection.</p>
          <div className="row-buttons">
            <button type="button" className="btn btn-ink" onClick={() => void promptInstall()}>
              Install
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="panel-text">
            In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. It opens full-screen and works without a connection.
          </p>
          {state.copies.length > 0 ? (
            <p className="panel-text">The installed app keeps its own storage. To bring your {state.copies.length} cards across, download a backup here first, then use "Replace with backup" inside the installed app.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function Home() {
  const state = useCollection();
  const friends = useFriends();
  useCatalogVersion();
  const byCard = copiesByCard(state);
  const total = state.copies.reduce((sum, c) => sum + copyValue(c), 0);
  const all = binderIds(state);
  const category = state.settings.category;
  const mine = all.filter((id) => categoryOf(id) === category);
  const label = CATEGORIES.find((c) => c.id === category)?.label ?? '';

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
          {all.length} {all.length === 1 ? 'set' : 'sets'}
        </div>
      </div>

      <div className="sports" role="group" aria-label="Card type">
        {CATEGORIES.map((c) => {
          const n = all.filter((id) => categoryOf(id) === c.id).length;
          return (
            <button key={c.id} type="button" className={c.id === category ? 'is-on' : ''} aria-pressed={c.id === category} disabled={!c.ready} onClick={() => updateSettings({ category: c.id })}>
              <span>{c.label}</span>
              <small>{c.ready ? `${n} ${n === 1 ? 'set' : 'sets'}` : 'later'}</small>
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
              <a key={id} className="binder-card binder-card-off" href={href(['set', id])}>
                <div className="binder-card-sub">This set has not downloaded yet. Open it when you are online.</div>
              </a>
            );
          }
          const stats = productStats(product, byCard, state.copies);
          return (
            <a key={id} className="binder-card" href={href(['set', id])}>
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
          );
        })}
        <a className="binder-add" href={href(['add'], { c: category })}>
          <span className="display-m">ADD A SET</span>
          <span>{mine.length === 0 ? `No ${label} sets yet. Pick one from the list, or scan a card and the app will find its set.` : `Browse every ${label} set`}</span>
        </a>
      </div>

      <Install />

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
