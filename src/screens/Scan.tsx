import { useEffect, useMemo, useRef, useState } from 'react';
import { CardFace } from '../components/CardFace';
import { Tick } from '../components/Chrome';
import { baseCount, cardKey, getProduct, versionsFor } from '../data/catalog';
import { estimate, money } from '../lib/estimate';
import { matchText, searchCards, type Candidate } from '../lib/match';
import { readText, toCanvas, warmUp } from '../lib/ocr';
import { href, type Route } from '../lib/router';
import { addCopy, copiesByCard, useCollection } from '../lib/store';

type Camera = 'starting' | 'live' | 'blocked' | 'off';

function CandidateRow({ c, owned, onPick }: { c: Candidate; owned: boolean; onPick: () => void }) {
  return (
    <li className="row">
      <button type="button" className="row-main row-button" onClick={onPick}>
        <Tick on={owned} />
        <span className="row-no">{c.card.n}</span>
        <span className="row-name">
          {c.card.p || 'Card'}{' '}
          <small>
            {c.card.t} · {c.product.name} {c.product.season}
            {c.section.id === 'base' ? '' : ` · ${c.section.name}`}
          </small>
        </span>
      </button>
    </li>
  );
}

export function Scan({ route }: { route: Route }) {
  const state = useCollection();
  const prefer = route.query.get('set') ?? undefined;
  const preferProduct = prefer ? getProduct(prefer) : undefined;
  const typeMode = route.query.get('mode') === 'type';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<Camera>(typeMode ? 'off' : 'starting');
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [problem, setProblem] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [version, setVersion] = useState('base');
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState('');
  const [session, setSession] = useState(0);

  const byCard = copiesByCard(state);
  const isOwned = (c: Candidate) => byCard.has(cardKey(c.product.id, c.section.id, c.card.n));
  const typed = useMemo(() => searchCards(query, { preferProduct: prefer }), [query, prefer]);

  useEffect(() => {
    if (typeMode) return;
    let cancelled = false;
    warmUp();
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('blocked');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamera('live');
      } catch {
        setCamera('blocked');
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [typeMode]);

  const read = async (canvas: HTMLCanvasElement) => {
    setBusy(true);
    setProblem('');
    setFound(null);
    setAdded('');
    setShot(canvas.toDataURL('image/jpeg', 0.7));
    try {
      const text = await readText(canvas);
      const candidates = matchText(text, { preferProduct: prefer });
      setFound(candidates);
      if (candidates.length === 0) setProblem('No player name could be read. Try again closer and flatter, or type the name below.');
    } catch {
      setProblem('The text reader could not load. Check your connection, or type the name below.');
    } finally {
      setBusy(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    void read(toCanvas(video));
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      await read(toCanvas(bitmap));
    } catch {
      setProblem('That photo could not be opened.');
    }
  };

  const pick = (c: Candidate) => {
    setPicked(c);
    setVersion(c.card.po ? versionsFor(c.product, c.section, c.card)[0]?.id ?? 'base' : 'base');
  };

  const reset = () => {
    setPicked(null);
    setFound(null);
    setShot(null);
    setProblem('');
    setQuery('');
  };

  const confirm = () => {
    if (!picked) return;
    addCopy({ product: picked.product.id, section: picked.section.id, n: picked.card.n, version });
    const key = cardKey(picked.product.id, picked.section.id, picked.card.n);
    const ownedNow = new Set(state.copies.filter((c) => c.product === picked.product.id && picked.product.sections.some((s) => s.kind === 'base' && s.id === c.section)).map((c) => cardKey(c.product, c.section, c.n)));
    if (picked.section.kind === 'base') ownedNow.add(key);
    setAdded(`Added ${picked.card.p} #${picked.card.n}. ${picked.product.name}: ${ownedNow.size}/${baseCount(picked.product)}.`);
    setSession((n) => n + 1);
    reset();
  };

  const closeTo = preferProduct ? href(['set', preferProduct.id]) : href([]);
  const results = query.trim() ? typed : found;
  const versions = picked ? versionsFor(picked.product, picked.section, picked.card) : [];

  return (
    <div className="scan">
      <header className="scan-top">
        <a className="scan-close" href={closeTo}>
          Close
        </a>
        <div className="scan-modes">
          <a className={typeMode ? '' : 'is-on'} href={href(['scan'], { set: prefer })}>
            CAMERA
          </a>
          <a className={typeMode ? 'is-on' : ''} href={href(['scan'], { set: prefer, mode: 'type' })}>
            TYPE
          </a>
        </div>
        <div className="scan-count">
          {session} added
          <br />
          this session
        </div>
      </header>

      {typeMode ? null : (
        <div className="viewfinder">
          <video ref={videoRef} playsInline muted className={shot ? 'is-hidden' : ''} />
          {shot ? <img src={shot} alt="The photo being read" /> : null}
          {camera === 'live' && !shot ? (
            <div className="guide" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {camera === 'blocked' ? (
            <div className="viewfinder-note">
              <p>The camera is not available here. It needs permission and a secure (https) page.</p>
              <p>You can still use a photo or type the name.</p>
            </div>
          ) : null}
          {camera === 'starting' ? <div className="viewfinder-note">Starting camera…</div> : null}
          {busy ? <div className="viewfinder-busy">Reading the card…</div> : null}
        </div>
      )}

      <div className={typeMode ? 'scan-sheet scan-sheet-full' : 'scan-sheet'}>
        {added ? (
          <p className="scan-added" role="status">
            <Tick on />
            {added}
          </p>
        ) : null}

        {picked ? (
          <div className="confirm">
            <div className="confirm-head">
              <div className="confirm-art">
                <CardFace card={picked.card} />
              </div>
              <div className="confirm-info">
                <div className="display-m">{(picked.card.p || 'Card').toUpperCase()}</div>
                <div className="sub">
                  No. {picked.card.n} · {picked.card.t}
                  <br />
                  {picked.product.season} {picked.product.brand} {picked.product.name}
                  {picked.section.id === 'base' ? '' : ` · ${picked.section.name}`}
                </div>
                <div className="price-m">{money(estimate(picked.product, picked.section, picked.card, version))}</div>
              </div>
            </div>
            {versions.length > 0 ? (
              <div className="field">
                <div className="field-label">Which version is it?</div>
                <div className="chips chips-scroll" role="group" aria-label="Version">
                  {picked.card.po ? null : (
                    <button type="button" className={version === 'base' ? 'chip is-on' : 'chip'} aria-pressed={version === 'base'} onClick={() => setVersion('base')}>
                      Base
                    </button>
                  )}
                  {versions.map((v) => (
                    <button key={v.id} type="button" className={version === v.id ? 'chip is-on' : 'chip'} aria-pressed={version === v.id} onClick={() => setVersion(v.id)}>
                      {v.name}
                      {v.sn ? ` /${v.sn}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="row-buttons">
              <button type="button" className="btn btn-red btn-big" onClick={confirm}>
                ADD TO BINDER
              </button>
              <button type="button" className="btn btn-big" onClick={() => setPicked(null)}>
                NOT THIS
              </button>
            </div>
          </div>
        ) : (
          <>
            {typeMode ? null : (
              <div className="row-buttons">
                <button type="button" className="btn btn-red btn-big" onClick={capture} disabled={camera !== 'live' || busy}>
                  {busy ? 'READING…' : shot ? 'READ AGAIN' : 'READ CARD'}
                </button>
                <label className="btn btn-big btn-file">
                  USE A PHOTO
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => void onPhoto(e.target.files?.[0])} />
                </label>
              </div>
            )}
            {shot && !busy ? (
              <button type="button" className="link-plain" onClick={reset}>
                Back to live camera
              </button>
            ) : null}

            <label className="field">
              <span className="field-label">{typeMode ? 'Player name or card number' : 'Or type the player name or number'}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Ovechkin or 8" autoComplete="off" autoFocus={typeMode} />
            </label>

            {problem && !query.trim() ? (
              <p className="panel-note" role="status">
                {problem}
              </p>
            ) : null}

            {results && results.length > 0 ? (
              <>
                <div className="eyebrow">{query.trim() ? `${results.length} MATCHES` : 'WHICH CARD IS IT?'}</div>
                <ul className="rows">
                  {results.map((c) => (
                    <CandidateRow key={cardKey(c.product.id, c.section.id, c.card.n)} c={c} owned={isOwned(c)} onPick={() => pick(c)} />
                  ))}
                </ul>
              </>
            ) : null}
            {query.trim() && typed.length === 0 ? <p className="panel-note">Nothing matches that in the four sets.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
