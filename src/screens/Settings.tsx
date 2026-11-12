import { useRef, useState, type ReactElement } from 'react';
import { BackButton, Screen } from '../components/Chrome';
import { CURRENCIES, ratesNote } from '../lib/currency';
import { EBAY_SITES } from '../lib/ebay';
import { promptInstall, useInstall } from '../lib/install';
import { photoCount, usePhotoVersion } from '../lib/photos';
import { DISCORD_URL, GITHUB_URL } from '../lib/links';
import { href, type Route } from '../lib/router';
import { Guesstimator } from './Guesstimator';
import { downloadBackup, eraseEverything, importBackup, isKindShown, isOwnPhoto, showKind, shownKinds, updateSettings, useCollection } from '../lib/store';
import { CATEGORIES } from '../types';

/** Which kinds of card have a tab. */
function CardTypes() {
  const state = useCollection();
  const shown = shownKinds(state.settings);
  return (
    <section className="panel" aria-labelledby="kinds-title">
      <h2 id="kinds-title" className="eyebrow">
        ADD OR HIDE CARD TYPES (E.G. BASEBALL, FOOTBALL)
      </h2>
      <p className="panel-text">Switch on the kinds of card you collect and switch off the ones you do not. A type that is off is only hidden: its sets and cards are kept. The app opens on the type you use most.</p>
      <div className="chips" role="group" aria-label="Card types shown">
        {CATEGORIES.map((c) => {
          const on = isKindShown(state.settings, c.id);
          return (
            <button key={c.id} type="button" className={on ? 'chip is-on' : 'chip'} aria-pressed={on} disabled={on && shown.length === 1} onClick={() => showKind(c.id, !on)}>
              {c.label}
            </button>
          );
        })}
      </div>
      <p className="mono-note">Baseball, Basketball, Football, Soccer and Other have no list the app is allowed to collect. Their sets come from checklist files you download and load under "Add a set".</p>
    </section>
  );
}

/** Where eBay links go and which currency values are shown in. */
function LinksAndValues() {
  const state = useCollection();
  return (
    <section className="panel" aria-labelledby="values-title">
      <h2 id="values-title" className="eyebrow">
        EBAY AND CURRENCY
      </h2>
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
      <label className="field field-inline">
        <span className="field-label">Show values in</span>
        <select value={state.settings.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({c.symbol})
            </option>
          ))}
        </select>
      </label>
      {state.settings.currency !== 'USD' ? <p className="mono-note">Converted from US dollars using {ratesNote()}.</p> : null}
    </section>
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

function About() {
  return (
    <>
      <section className="panel" aria-labelledby="about-title">
        <h2 id="about-title" className="eyebrow">
          WHAT THIS IS
        </h2>
        <p className="panel-text">Nine Pocket is a free tracker for trading card sets. Add a set and every card is an empty pocket; scan or tick off the cards you own and the binder fills in.</p>
        <p className="panel-text">There are no accounts and no adverts. Your collection stays in this browser on this device, and nothing is sent anywhere unless you share it yourself.</p>
      </section>

      <section className="panel" aria-labelledby="talk-title">
        <h2 id="talk-title" className="eyebrow">
          QUESTIONS AND IDEAS
        </h2>
        <p className="panel-text">Found a card that will not scan, a set that is wrong, or something you wish it did? Tell us.</p>
        <div className="row-buttons">
          {DISCORD_URL ? (
            <a className="btn btn-ink" href={DISCORD_URL} target="_blank" rel="noreferrer">
              Join the Discord
            </a>
          ) : null}
          <a className="btn" href={GITHUB_URL + '/issues'} target="_blank" rel="noreferrer">
            Report a problem on GitHub
          </a>
        </div>
      </section>

      <section className="panel" aria-labelledby="code-title">
        <h2 id="code-title" className="eyebrow">
          THE CODE
        </h2>
        <p className="panel-text">
          Open source under the MIT licence: free to use, change and share, as long as the copyright notice stays with it.
        </p>
        <div className="row-buttons">
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
        <p className="mono-note">Version {__BUILD__}</p>
      </section>

      <section className="panel" aria-labelledby="credits-title">
        <h2 id="credits-title" className="eyebrow">
          WHERE THE CARD LISTS COME FROM
        </h2>
        <p className="panel-text">Hockey: Upper Deck's published checklists. Magic: Scryfall. Pokémon: TCGdex. Other sports: checklist files you load yourself. The text reader is tesseract.js.</p>
        <p className="mono-note">Card names, logos and artwork belong to their owners. Values marked ~ are estimates from a simple formula, not sale prices.</p>
      </section>
    </>
  );
}

const PAGES: Record<string, { title: string; body: () => ReactElement | null }> = {
  about: { title: 'ABOUT', body: About },
  guesstimator: { title: 'THE GUESSTIMATOR', body: Guesstimator },
  types: { title: 'CARD TYPES', body: CardTypes },
  backup: { title: 'BACKUP FILES', body: Backup },
  values: { title: 'EBAY AND CURRENCY', body: LinksAndValues },
  install: { title: 'INSTALL THE APP', body: Install },
};

/** One page per entry in the home screen's menu; with no entry named, all of them. */
export function Settings({ route }: { route: Route }) {
  const page = PAGES[route.parts[1] ?? ''];
  const Body = page?.body;
  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href([])} label="Back to binders" />
          <div>
            <h1 className={page && page.title.length > 12 ? 'display-l is-long' : 'display-l'}>{page?.title ?? 'SETTINGS'}</h1>
            <div className="sub">Saved on this device</div>
          </div>
        </div>
      </header>
      {Body ? (
        <Body />
      ) : (
        <>
          <CardTypes />
          <LinksAndValues />
          <Backup />
          <Install />
        </>
      )}
    </Screen>
  );
}
