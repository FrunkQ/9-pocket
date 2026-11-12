import { useMemo, useState } from 'react';
import { BackButton, Screen } from '../components/Chrome';
import { getProduct, saveImported } from '../data/catalog';
import { buildProduct, readChecklistFile, readChecklistText, type Draft } from '../lib/checklist-file';
import { go, href, type Route } from '../lib/router';
import { addBinder, showKind, updateSettings } from '../lib/store';
import { CATEGORIES, type Category } from '../types';

// Magic and Pokémon have complete catalogues already; a file adds nothing there.
const KINDS = CATEGORIES.filter((c) => c.id !== 'mtg' && c.id !== 'pokemon');

/**
 * Makes a set from a checklist file the user has downloaded themselves,
 * for card makers whose checklists the app is not allowed to collect.
 */
export function ImportSet({ route }: { route: Route }) {
  const wanted = route.query.get('c') as Category | null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [kind, setKind] = useState<Category>(KINDS.find((c) => c.id === wanted)?.id ?? 'other');
  const [pasted, setPasted] = useState('');
  const sport = KINDS.find((c) => c.id === kind)?.label ?? '';
  const [looking, setLooking] = useState(kind === 'other' ? '' : sport);

  const readPasted = () => {
    setProblem('');
    setDraft(null);
    try {
      const read = readChecklistText(pasted);
      setDraft(read);
      setName(read.name);
      setSeason(read.season);
    } catch {
      setProblem('No list of cards was found in what you pasted. It needs one card per line with the card number first, then the name.');
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem('');
    setDraft(null);
    try {
      const read = await readChecklistFile(file);
      setDraft(read);
      setName(read.name);
      setSeason(read.season);
      if (read.kind) setKind(read.kind);
    } catch {
      setProblem('No list of cards was found in that file. It needs one card per line with the card number first, then the name. A PDF made of scanned pictures cannot be read.');
    } finally {
      setBusy(false);
    }
  };

  const product = useMemo(() => (draft ? buildProduct(draft, { name, season, kind }) : null), [draft, name, season, kind]);
  const base = product?.sections[0];
  const inserts = product ? product.sections.slice(1) : [];
  const replaces = product ? getProduct(product.id) !== undefined : false;

  const add = async () => {
    if (!product) return;
    setBusy(true);
    try {
      await saveImported(product);
    } catch {
      setProblem('The set could not be saved on this device. Storage may be full or switched off.');
      setBusy(false);
      return;
    }
    addBinder(product.id);
    showKind(kind, true);
    updateSettings({ category: kind });
    go(['set', product.id]);
  };

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href(['add'], { c: kind })} label="Back to add a set" />
          <div>
            <h1 className="display-l is-long">LOAD A CHECKLIST</h1>
            <div className="sub">From a file you have downloaded</div>
          </div>
        </div>
      </header>

      {!draft ? (
        <>
          <p className="panel-text">
            Topps and other card makers publish their checklists for collectors to read and download, but do not license them to apps, and their sites turn automated readers away. So this one step is yours: you fetch the list, and the app reads it. The set is kept on this device and nothing is uploaded.
          </p>

          <div className="eyebrow">1. FIND THE CHECKLIST ON TOPPS</div>
          <p className="panel-text">Topps posts a "Checklist Spotlight" article for each set on its Topps Ripped site. Open the list of those articles, or search for your set.</p>
          <div className="row-buttons">
            <a className="btn btn-ink" href="https://ripped.topps.com/tag/checklist-spotlight/" target="_blank" rel="noreferrer">
              Open Topps checklist articles
            </a>
          </div>
          <label className="field">
            <span className="field-label">Or search Topps for a set</span>
            <input type="search" value={looking} onChange={(e) => setLooking(e.target.value)} placeholder="e.g. 2026 Series 1 baseball" autoComplete="off" />
          </label>
          {looking.trim() ? (
            <a className="link-plain" href={`https://ripped.topps.com/?s=${encodeURIComponent(looking.trim() + ' checklist')}`} target="_blank" rel="noreferrer">
              Search Topps Ripped for "{looking.trim()} checklist"
            </a>
          ) : null}

          <div className="eyebrow">2. GET THE LIST OUT OF THE ARTICLE</div>
          <ol className="steps">
            <li>
              <strong>If the article has a "Checklist" link</strong>, it opens a PDF. Save the PDF, then choose it below.
            </li>
            <li>
              <strong>If the list is printed in the article itself</strong>, select the whole list, copy it, and paste it into the box below.
            </li>
          </ol>
          <p className="mono-note">Articles from before September 2025 mostly link to files Topps has since taken down. If the link is dead and the list is not on the page, that set cannot be loaded this way.</p>

          <div className="eyebrow">3. GIVE IT TO THE APP</div>
        </>
      ) : null}

      <div className="row-buttons">
        <label className={draft ? 'btn btn-file' : 'btn btn-red btn-big btn-file'}>
          {busy && !draft ? 'READING…' : draft ? 'Choose a different file' : 'CHOOSE A FILE'}
          <input type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
      </div>

      {!draft ? (
        <>
          <label className="field">
            <span className="field-label">Or paste a list copied from a page</span>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder={'1\tPlayer name\tTeam\n2\tPlayer name\tTeam'} spellCheck={false} />
          </label>
          {pasted.trim() ? (
            <div className="row-buttons">
              <button type="button" className="btn btn-ink" onClick={readPasted}>
                Read the pasted list
              </button>
            </div>
          ) : null}
          <p className="mono-note">Other makers' lists work the same way, as long as there is one card per line with its number first. Files can be PDF, .csv or .txt.</p>
        </>
      ) : null}

      {problem ? (
        <p className="panel-note" role="status">
          {problem}
        </p>
      ) : null}

      {draft && product && base ? (
        <>
          <p className="mono-note legend">
            {draft.fileName}: {draft.cards} lines of cards under {draft.sections.length} {draft.sections.length === 1 ? 'heading' : 'headings'}.
          </p>

          <label className="field">
            <span className="field-label">Set name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Year or season</span>
            <input type="text" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. 2026 or 2026-27" maxLength={12} autoComplete="off" />
          </label>
          <label className="field field-inline">
            <span className="field-label">Kind of card</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Category)}>
              {KINDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="eyebrow">WHAT WAS FOUND</div>
          <ul className="rows">
            <li className="row">
              <span className="row-main">
                <span className="row-name">
                  Base set <small>{base.cards.slice(0, 3).map((c) => `${c.n} ${c.p}`).join(', ')}…</small>
                </span>
                <span className="row-price">{base.cards.length} cards</span>
              </span>
            </li>
            {product.parallels.length > 0 ? (
              <li className="row">
                <span className="row-main">
                  <span className="row-name">
                    Versions of the base cards <small>{product.parallels.slice(0, 6).map((p) => p.name).join(', ')}{product.parallels.length > 6 ? '…' : ''}</small>
                  </span>
                  <span className="row-price">{product.parallels.length}</span>
                </span>
              </li>
            ) : null}
            {inserts.length > 0 ? (
              <li className="row">
                <span className="row-main">
                  <span className="row-name">
                    Insert sets <small>{inserts.slice(0, 6).map((s) => s.name).join(', ')}{inserts.length > 6 ? '…' : ''}</small>
                  </span>
                  <span className="row-price">
                    {inserts.length} · {inserts.reduce((n, s) => n + s.cards.length, 0)} cards
                  </span>
                </span>
              </li>
            ) : null}
          </ul>

          {replaces ? <p className="panel-note">This set is already on this device. Adding it again replaces its list; the cards you have recorded in it are kept.</p> : null}

          <div className="row-buttons">
            <button type="button" className="btn btn-red btn-big" onClick={() => void add()} disabled={busy || !name.trim()}>
              ADD THIS SET
            </button>
          </div>
          <p className="mono-note">Check the base set looks right before adding. If the first cards above are wrong, the file is laid out in a way the app does not understand yet.</p>
        </>
      ) : null}
    </Screen>
  );
}
