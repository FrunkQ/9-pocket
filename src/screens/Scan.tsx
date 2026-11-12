import { useEffect, useMemo, useRef, useState } from 'react';
import { CardFace } from '../components/CardFace';
import { Tick } from '../components/Chrome';
import { baseCount, cardKey, categoryOf, ensureProduct, getCard, getProduct, isOther, OTHER, otherLabel, otherVersion, useCatalogVersion, versionsFor } from '../data/catalog';
import { cropFrame, guideCrop, keepFocusing, openCamera, preferredCamera, rearCameras, refocus } from '../lib/capture';
import { priceText } from '../lib/estimate';
import { findSets, type SetHit } from '../lib/identify';
import { fold, isConfident, matchText, sameName, searchCards, type Candidate } from '../lib/match';
import { PASS_COUNT, readCard, toCanvas, warmUp } from '../lib/ocr';
import { savePhoto } from '../lib/photos';
import { href, type Route } from '../lib/router';
import { straighten } from '../lib/straighten';
import { addBinder, addCopy, binderIds, copiesByCard, namedVersions, updateSettings, useCollection } from '../lib/store';
import { CATEGORIES, type Category } from '../types';
import { ScanSelect } from './ScanSelect';

type Camera = 'starting' | 'live' | 'blocked' | 'off';

const ZOOMS = [1, 1.5, 2, 3];
/** Cards per shot: one, or a square layout of 4, 9 or 16. */
const GRIDS = [1, 2, 3, 4];
/** Below this many pixels across a card, names stop reading reliably. */
const MIN_CARD_PX = 320;

/** One card from a multi-card shot, with what it was matched to. */
interface BatchItem {
  canvas: HTMLCanvasElement;
  thumb: string;
  candidates: Candidate[];
  /** Index into candidates, or -1 to leave this card out. */
  choice: number;
}
/** Spare border captured around the guide so the card's edges are in the picture. */
const MARGIN = 0.08;

const where = (c: Candidate) => [c.card.t, [c.product.name, c.product.season].filter(Boolean).join(' '), c.section.id === 'base' ? '' : c.section.name].filter(Boolean).join(' · ');

function CandidateRow({ c, owned, dim, onPick }: { c: Candidate; owned: boolean; dim?: boolean; onPick: () => void }) {
  return (
    <li className={dim ? 'row row-dim' : 'row'}>
      <button type="button" className="row-main row-button" onClick={onPick}>
        <Tick on={owned} />
        <span className="row-no">{c.card.n}</span>
        <span className="row-name">
          {c.card.p || 'Card'} <small>{[c.card.t, [c.product.name, c.product.season].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</small>
        </span>
        {c.section.id === 'base' ? null : <span className="tag row-tag">{c.section.name}</span>}
      </button>
    </li>
  );
}

export function Scan({ route }: { route: Route }) {
  const state = useCollection();
  const catalogVersion = useCatalogVersion();
  const prefer = route.query.get('set') ?? undefined;
  const preferProduct = prefer ? getProduct(prefer) : undefined;
  const mode = route.query.get('mode');
  const selectMode = mode === 'select';
  // Neither typing nor selecting uses the camera.
  const typeMode = mode === 'type' || selectMode;
  const cameraId = state.settings.cameraId;
  const category: Category = prefer ? categoryOf(prefer) : state.settings.category;

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cardRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef('');
  const autoPicked = useRef(false);

  const [camera, setCamera] = useState<Camera>(typeMode ? 'off' : 'starting');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(1);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [cardPx, setCardPx] = useState(0);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  const [flattened, setFlattened] = useState(false);
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [others, setOthers] = useState<SetHit[] | null>(null);
  // True when the list of other sets came from what the card itself prints, unasked.
  const [said, setSaid] = useState(false);
  const [looking, setLooking] = useState(false);
  const [fetching, setFetching] = useState('');
  const [problem, setProblem] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [version, setVersion] = useState('base');
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState('');
  const [session, setSession] = useState(0);

  const byCard = copiesByCard(state);
  const isOwned = (c: Candidate) => byCard.has(cardKey(c.product.id, c.section.id, c.card.n));
  // Recomputed when a set finishes downloading, so its cards show up at once.
  // A scanned card is far more likely to be from a set already in the binders,
  // and most likely from the set the last card went into.
  const have = useMemo(() => new Set(binderIds(state)), [state]);
  const recent = useMemo(() => state.copies.reduce<{ product: string; added: string } | undefined>((a, c) => (!a || c.added > a.added ? c : a), undefined)?.product, [state]);
  const likely = { preferProduct: prefer, have, recent };
  const typed = useMemo(() => searchCards(query, { preferProduct: prefer, have }), [query, prefer, have, catalogVersion]);

  useEffect(() => {
    if (typeMode) return;
    let cancelled = false;
    warmUp();
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('blocked');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await openCamera(cameraId || undefined);
      } catch {
        if (cameraId) {
          // The remembered lens is gone or refused: fall back to the default.
          updateSettings({ cameraId: '' });
          return;
        }
        setCamera('blocked');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      void keepFocusing(track);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamera('live');

      const list = await rearCameras().catch(() => [] as MediaDeviceInfo[]);
      if (cancelled) return;
      setCameras(list);
      // First time only: move to the phone's combined rear camera, which
      // switches to its close-focus lens by itself.
      if (!cameraId && !autoPicked.current) {
        autoPicked.current = true;
        const better = preferredCamera(list);
        if (better && better.deviceId && better.deviceId !== track.getSettings().deviceId) updateSettings({ cameraId: better.deviceId });
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [typeMode, cameraId]);

  const read = async (source: HTMLCanvasElement, margin: number) => {
    setBusy(true);
    setPass(0);
    setProblem('');
    setFound(null);
    setOthers(null);
    setSaid(false);
    setAdded('');
    try {
      const flat = straighten(source, 1000, margin);
      cardRef.current = flat.canvas;
      setFlattened(flat.found);
      setShot(flat.canvas.toDataURL('image/jpeg', 0.75));
      let best: Candidate[] = [];
      // Read the card several ways, stopping as soon as one reading is convincing.
      textRef.current = await readCard(flat.canvas, (text, n) => {
        best = matchText(text, likely);
        setPass(n + 1);
        return isConfident(best);
      });
      setFound(best);
      if (best.length === 0) setProblem('That card is not in the sets on this device. Look for its set below, try the back of the card (plainer lettering), or type the name.');
      // A card that names its own set or subset ("2025-26 SP HOCKEY", "ROOKIE
      // AUTHENTICS") may belong to a set that is not in the binders, even when
      // the player was found in one that is. Offer that set without being asked.
      if (category === 'hockey' && textRef.current.trim()) {
        const named = (await findSets(textRef.current, 'hockey')).filter((hit) => hit.sure);
        const top = named[0];
        if (top && !have.has(top.set.id)) {
          setSaid(true);
          setOthers(named.filter((hit) => !have.has(hit.set.id) && hit.score >= top.score - 0.3).slice(0, 3));
        }
      }
    } catch {
      setProblem('The text reader could not load. Check your connection, or type the name below.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reads a shot of n-by-n cards laid out edge to edge. `margin` is the
   * spare border around the layout, as a share of the picture's size.
   */
  const readGrid = async (source: HTMLCanvasElement, n: number, margin: number) => {
    setBusy(true);
    setProblem('');
    setFound(null);
    setOthers(null);
    setAdded('');
    setBatch(null);
    setShot(source.toDataURL('image/jpeg', 0.7));
    setFlattened(false);
    const left = source.width * margin;
    const top = source.height * margin;
    const cellW = (source.width - left * 2) / n;
    const cellH = (source.height - top * 2) / n;
    setCardPx(Math.round(cellW));
    const SPARE = 0.05; // A little of the neighbours, so each card's own edges are in its piece.
    const items: BatchItem[] = [];
    try {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          setProgress(`Reading card ${r * n + c + 1} of ${n * n}…`);
          const x = Math.max(0, left + (c - SPARE) * cellW);
          const y = Math.max(0, top + (r - SPARE) * cellH);
          const w = Math.min(source.width - x, cellW * (1 + SPARE * 2));
          const h = Math.min(source.height - y, cellH * (1 + SPARE * 2));
          const piece = document.createElement('canvas');
          piece.width = Math.round(w);
          piece.height = Math.round(h);
          piece.getContext('2d')!.drawImage(source, x, y, w, h, 0, 0, piece.width, piece.height);
          const flat = straighten(piece, 800, SPARE / (1 + SPARE * 2));
          let best: Candidate[] = [];
          await readCard(flat.canvas, (text) => {
            best = matchText(text, likely);
            return isConfident(best);
          });
          const small = document.createElement('canvas');
          small.width = 150;
          small.height = 210;
          small.getContext('2d')!.drawImage(flat.canvas, 0, 0, 150, 210);
          items.push({ canvas: flat.canvas, thumb: small.toDataURL('image/jpeg', 0.6), candidates: best.slice(0, 5), choice: best.length && best[0].name >= 0.75 ? 0 : -1 });
        }
      }
      setBatch(items);
    } catch {
      setProblem('The text reader could not load. Check your connection.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const view = viewRef.current;
    const guide = guideRef.current;
    if (!video || !view || !guide || video.videoWidth === 0) return;
    const rect = guideCrop(view.getBoundingClientRect(), guide.getBoundingClientRect(), video.videoWidth, video.videoHeight, zoom, grid > 1 ? 0.02 : MARGIN);
    if (grid > 1) void readGrid(cropFrame(video, rect), grid, 0.02 / 1.04);
    else void read(cropFrame(video, rect), MARGIN / (1 + MARGIN * 2));
  };

  const setChoice = (index: number, choice: number) => setBatch((items) => items && items.map((item, i) => (i === index ? { ...item, choice } : item)));

  /** Adds every card in the shot that has a match selected. */
  const confirmBatch = () => {
    if (!batch) return;
    let count = 0;
    for (const item of batch) {
      const c = item.candidates[item.choice];
      if (!c) continue;
      const version = c.card.po ? versionsFor(c.product, c.section, c.card)[0]?.id ?? 'base' : 'base';
      const copy = addCopy({ product: c.product.id, section: c.section.id, n: c.card.n, version });
      addBinder(c.product.id);
      void savePhoto(copy.id, cardKey(c.product.id, c.section.id, c.card.n), item.canvas);
      count++;
    }
    setSession((n) => n + count);
    reset();
    setAdded(`Added ${count} ${count === 1 ? 'card' : 'cards'} from that shot.`);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      // A photo from the phone's own camera app has far more detail than a video frame.
      if (grid > 1) await readGrid(toCanvas(bitmap, 4200), grid, 0);
      else await read(toCanvas(bitmap, 2000), 0);
    } catch {
      setProblem('That photo could not be opened.');
    }
  };

  const tapFocus = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track && !shot) void refocus(track);
  };

  /** Looks for the card in sets that are not on the device yet. */
  const lookElsewhere = async (kind: Category) => {
    const text = query.trim() || textRef.current;
    if (!text.trim()) return;
    updateSettings({ category: kind });
    setLooking(true);
    setProblem('');
    const hits = await findSets(text, kind);
    setLooking(false);
    setSaid(false);
    setOthers(hits);
    if (hits.length === 0) setProblem(`No ${CATEGORIES.find((c) => c.id === kind)?.label ?? ''} set was found for that. Try the back of the card, or add the set from the list.`);
  };

  /** Downloads a suggested set, adds it as a binder, and goes straight to the card. */
  const useSet = async (hit: SetHit) => {
    setFetching(hit.set.id);
    const product = await ensureProduct(hit.set.id);
    setFetching('');
    if (!product) {
      setProblem(`${hit.set.name} could not be downloaded. Check your connection.`);
      return;
    }
    addBinder(product.id);
    setOthers(null);
    // The source told us the exact card where it could; otherwise match again within the new set.
    for (const section of product.sections) {
      const card = hit.n ? getCard(section, hit.n) : undefined;
      if (card) {
        pick({ product, section, card, score: 1, name: 1, evidence: [] });
        return;
      }
    }
    const again = (query.trim() ? searchCards(query, { preferProduct: product.id }) : matchText(textRef.current, { preferProduct: product.id })).filter((c) => c.product.id === product.id);
    if (again.length === 1) pick(again[0]);
    else setFound(again);
  };

  const pick = (c: Candidate) => {
    setPicked(c);
    const versions = versionsFor(c.product, c.section, c.card);
    // Recent card backs print the version on a line of its own ("BLUE").
    const lines = query.trim() ? new Set<string>() : new Set(textRef.current.split('\n').map(fold));
    const printed = versions.find((v) => lines.has(fold(v.name)));
    setVersion(printed?.id ?? (c.card.po ? versions[0]?.id ?? 'base' : 'base'));
  };

  const reset = () => {
    setPicked(null);
    setFound(null);
    setOthers(null);
    setBatch(null);
    setShot(null);
    setProblem('');
    setQuery('');
    cardRef.current = null;
    textRef.current = '';
  };

  const confirm = () => {
    if (!picked) return;
    const copy = addCopy({ product: picked.product.id, section: picked.section.id, n: picked.card.n, version });
    addBinder(picked.product.id);
    const key = cardKey(picked.product.id, picked.section.id, picked.card.n);
    if (cardRef.current) void savePhoto(copy.id, key, cardRef.current);
    const ownedNow = new Set(state.copies.filter((c) => c.product === picked.product.id && picked.product.sections.some((s) => s.kind === 'base' && s.id === c.section)).map((c) => cardKey(c.product, c.section, c.n)));
    if (picked.section.kind === 'base') ownedNow.add(key);
    setAdded(`Added ${picked.card.p} #${picked.card.n}. ${picked.product.name}: ${ownedNow.size}/${baseCount(picked.product)}.`);
    setSession((n) => n + 1);
    reset();
  };

  const otherSets =
    others && others.length > 0 ? (
              <>
                <div className="eyebrow">{said ? 'THE CARD SAYS IT IS FROM A SET YOU HAVE NOT ADDED' : 'FOUND IN THESE SETS'}</div>
                <ul className="rows">
                  {others.map((hit) => (
                    <li key={hit.set.id + (hit.n ?? '')} className="row">
                      <button type="button" className="row-main row-button" onClick={() => void useSet(hit)} disabled={fetching !== ''}>
                        {hit.img ? (
                          <span className="row-thumb">
                            <img src={hit.img} alt="" loading="lazy" />
                          </span>
                        ) : null}
                        <span className="row-name">
                          {hit.cardName}{' '}
                          <small>
                            {[hit.set.season, hit.set.name].filter(Boolean).join(' ')}
                            {hit.part ? ` · ${hit.part}` : ''}
                            {hit.n ? ` · No. ${hit.n}` : ''}
                          </small>
                        </span>
                        <span className="row-price">{fetching === hit.set.id ? 'Downloading…' : getProduct(hit.set.id) ? 'Use' : 'Add set'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
    ) : null;

  const closeTo = preferProduct ? href(['set', preferProduct.id]) : href([]);
  const results = query.trim() ? typed : found;
  // Matches from sets the user has come first; the rest are shown greyed.
  const mine = (results ?? []).filter((c) => have.size === 0 || have.has(c.product.id));
  const elsewhere = (results ?? []).filter((c) => have.size > 0 && !have.has(c.product.id));
  const versions = picked ? versionsFor(picked.product, picked.section, picked.card) : [];
  // Names the user has already given to unlisted versions in this set.
  const named = picked ? namedVersions(state, picked.product.id) : [];
  const naming = isOther(version) && !named.includes(otherLabel(version).trim());
  // The same player's other cards in this set: the reader finds the name, but
  // cannot tell a base card from a sticker or an insert.
  const siblings = picked ? sameName(picked.product, picked.card).slice(0, 12) : [];
  const canLook = !picked && !busy && (query.trim().length >= 3 || (found !== null && textRef.current.trim().length > 0));

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
          <a className={mode === 'type' ? 'is-on' : ''} href={href(['scan'], { set: prefer, mode: 'type' })}>
            TYPE
          </a>
          <a className={selectMode ? 'is-on' : ''} href={href(['scan'], { set: prefer, mode: 'select' })}>
            SELECT
          </a>
        </div>
        <div className="scan-count">
          {session} added
          <br />
          this session
        </div>
      </header>

      {typeMode ? null : (
        <div className="viewfinder" ref={viewRef} onClick={tapFocus}>
          <video ref={videoRef} playsInline muted className={shot ? 'is-hidden' : ''} style={{ transform: `scale(${zoom})` }} />
          {shot ? <img src={shot} alt="The card as it will be saved" /> : null}
          {camera === 'live' && !shot ? (
            <div className="guide" ref={guideRef} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              {grid > 1 ? (
                <div className="guide-cells" style={{ gridTemplateColumns: `repeat(${grid}, 1fr)`, gridTemplateRows: `repeat(${grid}, 1fr)` }}>
                  {Array.from({ length: grid * grid }, (_, i) => (
                    <b key={i} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {camera === 'blocked' && !shot ? (
            <div className="viewfinder-note">
              <p>The camera is not available here. It needs permission and a secure (https) page.</p>
              <p>You can still use a photo or type the name.</p>
            </div>
          ) : null}
          {camera === 'starting' ? <div className="viewfinder-note">Starting camera…</div> : null}
          {busy ? (
            <div className="viewfinder-busy">
              {progress || `Reading the card… ${pass}/${PASS_COUNT}`}
            </div>
          ) : null}
          {shot && !busy && !batch ? <div className="viewfinder-tag">{flattened ? 'Straightened' : 'Edges not found, cropped to the frame'}</div> : null}
          {shot && !busy && batch ? <div className="viewfinder-tag">About {cardPx} pixels across each card</div> : null}
        </div>
      )}

      <div className={typeMode ? 'scan-sheet scan-sheet-full' : 'scan-sheet'}>
        {added ? (
          <p className="scan-added" role="status">
            <Tick on />
            {added}
          </p>
        ) : null}

        {selectMode ? (
          <ScanSelect setId={prefer} sectionId={route.query.get('s') ?? undefined} onChange={(delta) => setSession((n) => Math.max(0, n + delta))} />
        ) : picked ? (
          <div className="confirm">
            <div className="confirm-head">
              <div className="confirm-art">
                <CardFace card={picked.card} photo={shot ?? undefined} />
              </div>
              <div className="confirm-info">
                <div className="display-m">{(picked.card.p || 'Card').toUpperCase()}</div>
                <div className="sub">
                  No. {picked.card.n}
                  {picked.card.t ? ` · ${picked.card.t}` : ''}
                  <br />
                  {[picked.product.season, picked.product.brand, picked.product.name].filter(Boolean).join(' ')}
                  {picked.section.id === 'base' ? '' : ` · ${picked.section.name}`}
                </div>
                <div className="price-m">{priceText(picked.product, picked.section, picked.card, version)}</div>
              </div>
            </div>
            {siblings.length > 1 ? (
              <div className="field">
                <div className="field-label">Which {picked.card.p} card?</div>
                <div className="chips chips-scroll" role="group" aria-label="Which card">
                  {siblings.map((s) => {
                    const on = s.section.id === picked.section.id && s.card.n === picked.card.n;
                    return (
                      <button key={s.section.id + s.card.n} type="button" className={on ? 'chip is-on' : 'chip'} aria-pressed={on} onClick={() => pick(s)}>
                        {s.section.id === 'base' ? 'Base' : s.section.name} · {s.card.n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {picked ? (
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
                  {named.map((name) => (
                    <button key={name} type="button" className={version === otherVersion(name) ? 'chip is-on' : 'chip'} aria-pressed={version === otherVersion(name)} onClick={() => setVersion(otherVersion(name))}>
                      {name}
                    </button>
                  ))}
                  <button type="button" className={naming ? 'chip is-on' : 'chip'} aria-pressed={naming} onClick={() => setVersion(naming ? version : OTHER)}>
                    Other
                  </button>
                </div>
                {naming ? <input type="text" aria-label="What is this version called?" value={otherLabel(version)} onChange={(e) => setVersion(otherVersion(e.target.value))} placeholder="What is it called? e.g. Blue" maxLength={40} autoComplete="off" /> : null}
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
              <>
                <div className="row-buttons">
                  <button type="button" className="btn btn-red btn-big" onClick={shot ? reset : capture} disabled={camera !== 'live' || busy}>
                    {busy ? 'READING…' : shot ? 'SCAN AGAIN' : 'READ CARD'}
                  </button>
                  <label className="btn btn-big btn-file">
                    USE A PHOTO
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => void onPhoto(e.target.files?.[0])} />
                  </label>
                </div>
                {!shot ? (
                  <div className="scan-tools">
                    <div className="zooms" role="group" aria-label="Cards per shot">
                      {GRIDS.map((g) => (
                        <button key={g} type="button" className={grid === g ? 'is-on' : ''} aria-pressed={grid === g} onClick={() => setGrid(g)}>
                          {g === 1 ? '1 card' : `${g}×${g}`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {camera === 'live' && !shot ? (
                  <div className="scan-tools">
                    <div className="zooms" role="group" aria-label="Zoom">
                      {ZOOMS.map((z) => (
                        <button key={z} type="button" className={zoom === z ? 'is-on' : ''} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                          {z}×
                        </button>
                      ))}
                    </div>
                    {cameras.length > 1 ? (
                      <select aria-label="Camera" value={cameraId} onChange={(e) => updateSettings({ cameraId: e.target.value })}>
                        <option value="">Default camera</option>
                        {cameras.map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Camera ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}
                {!shot && grid > 1 ? (
                  <p className="mono-note">
                    Lay {grid * grid} cards edge to edge in a {grid}×{grid} block and fill the frame with them. The more cards per shot, the fewer pixels each one gets: if names stop reading, use fewer cards, or "Use a photo", which captures far more detail than live video.
                  </p>
                ) : null}
                {!shot ? <p className="mono-note">Take cards out of sleeves and top-loaders if you can. The app finds a bare card's edges and crops the photo much more cleanly, and there is no glare over the name.</p> : null}
                {camera === 'live' && !shot && grid === 1 ? <p className="mono-note">Blurry? Hold the phone further back and zoom in. Tap the picture to refocus. Fancy lettering on the front? The back usually reads better.</p> : null}
              </>
            )}

            {batch ? (
              <div className="batch">
                <div className="eyebrow">
                  {batch.filter((b) => b.choice >= 0).length} OF {batch.length} CARDS MATCHED
                </div>
                {cardPx < MIN_CARD_PX ? <p className="panel-note">Each card was only about {cardPx} pixels across, which is too small to read reliably. Try fewer cards per shot, or "Use a photo".</p> : null}
                <ul className="rows">
                  {batch.map((item, i) => (
                    <li key={i} className="row batch-row">
                      <span className="row-thumb">
                        <img src={item.thumb} alt={`Card ${i + 1}`} />
                      </span>
                      <select aria-label={`Card ${i + 1}`} value={item.choice} onChange={(e) => setChoice(i, Number(e.target.value))}>
                        {item.candidates.map((c, j) => (
                          <option key={j} value={j}>
                            {c.card.p} #{c.card.n} · {where(c)}
                          </option>
                        ))}
                        <option value={-1}>{item.candidates.length ? 'Leave this one out' : 'Not recognised'}</option>
                      </select>
                    </li>
                  ))}
                </ul>
                <div className="row-buttons">
                  <button type="button" className="btn btn-red btn-big" onClick={confirmBatch} disabled={!batch.some((b) => b.choice >= 0)}>
                    ADD {batch.filter((b) => b.choice >= 0).length} CARDS
                  </button>
                </div>
              </div>
            ) : null}

            <label className="field">
              <span className="field-label">{typeMode ? 'Player or card name, or card number' : 'Or type the name or number'}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Ovechkin or 8" autoComplete="off" autoFocus={typeMode} />
            </label>

            {problem ? (
              <p className="panel-note" role="status">
                {problem}
              </p>
            ) : null}

            {said ? otherSets : null}

            {results && results.length > 0 ? (
              <>
                <div className="eyebrow">{query.trim() ? `${results.length} MATCHES IN YOUR SETS` : 'WHICH CARD IS IT?'}</div>
                {mine.length > 0 ? (
                  <ul className="rows">
                    {mine.map((c) => (
                      <CandidateRow key={cardKey(c.product.id, c.section.id, c.card.n)} c={c} owned={isOwned(c)} onPick={() => pick(c)} />
                    ))}
                  </ul>
                ) : null}
                {elsewhere.length > 0 ? (
                  <>
                    <div className="eyebrow">LESS LIKELY: SETS NOT IN YOUR BINDERS</div>
                    <ul className="rows">
                      {elsewhere.map((c) => (
                        <CandidateRow key={cardKey(c.product.id, c.section.id, c.card.n)} c={c} owned={isOwned(c)} dim onPick={() => pick(c)} />
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : null}
            {query.trim() && typed.length === 0 ? <p className="panel-note">Nothing matches in the sets on this device.</p> : null}

            {canLook ? (
              <div className="field">
                <div className="field-label">Not listed? Find its set and add it</div>
                <div className="chips" role="group" aria-label="Kind of card">
                  {CATEGORIES.filter((c) => c.ready).map((c) => (
                    <button key={c.id} type="button" className={c.id === category ? 'chip is-on' : 'chip'} onClick={() => void lookElsewhere(c.id)} disabled={looking}>
                      {looking && c.id === category ? 'Looking…' : `${c.label} sets`}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {said ? null : otherSets}
          </>
        )}
      </div>
    </div>
  );
}
