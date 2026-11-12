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
const MARGIN = 0.12;

const where = (c: Candidate) => [c.card.t, [c.product.name, c.product.season].filter(Boolean).join(' '), c.section.id === 'base' ? '' : c.section.name].filter(Boolean).join(' · ');

/** True when the text is the small print of a card's back (vitals, stats, copyright) rather than a front. */
function looksLikeBack(text: string): boolean {
  const signs = new Set((text.match(/\b(height|weight|shoots|catches|born|printed in|company|nhlpa|pts|pim)\b/gi) ?? []).map((w) => w.toLowerCase()));
  return signs.size >= 2;
}

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
  // The first side of a card, kept while the other side is being shot.
  const keptRef = useRef<{ canvas: HTMLCanvasElement; text: string; url: string; flat: boolean } | null>(null);

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
  const [tooClose, setTooClose] = useState(false);
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [others, setOthers] = useState<SetHit[] | null>(null);
  // True when the list of other sets came from what the card itself prints, unasked.
  const [said, setSaid] = useState(false);
  // A second shot of the same card: its back, read for the set but not kept
  // as the picture; or its front, kept as the picture but not read.
  const [side, setSide] = useState<'back' | 'front' | null>(null);
  const [frontTaken, setFrontTaken] = useState(false);
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
    // Reading the back of a card whose front is already held: the front stays the picture.
    const kept = side === 'back' ? keptRef.current : null;
    try {
      const flat = straighten(source, 1000, margin);
      if (!kept) {
        cardRef.current = flat.canvas;
        setFrontTaken(false);
      }
      setFlattened(flat.found);
      setTooClose(flat.tooClose);
      setShot(flat.canvas.toDataURL('image/jpeg', 0.75));
      let best: Candidate[] = [];
      if (kept) {
        // A back is plain print. Read until its small print shows up, a few passes at most.
        const back = await readCard(
          flat.canvas,
          (text, n) => {
            best = matchText(kept.text + '\n' + text, likely);
            setPass(n + 1);
            return looksLikeBack(text) || n >= 3;
          },
          true,
        );
        textRef.current = kept.text + '\n' + back;
        setShot(kept.url);
        setFlattened(kept.flat);
        keptRef.current = null;
        setSide(null);
        setFrontTaken(true);
      } else {
        // Read the card several ways, stopping as soon as one reading is convincing.
        textRef.current = await readCard(flat.canvas, (text, n) => {
          best = matchText(text, likely);
          setPass(n + 1);
          return isConfident(best);
        });
      }
      setFound(best);
      // Matching only looks in sets already on this device. So also ask which
      // sets the card could be from: always when nothing matched, and for hockey
      // every time, because a card that names its own set or subset ("2025-26 SP
      // HOCKEY", "ROOKIE AUTHENTICS") may belong to a set that is not in the
      // binders even when the player was found in one that is.
      const lookUp = textRef.current.trim() !== '' && (best.length === 0 || category === 'hockey');
      const all = lookUp ? await findSets(textRef.current, category) : [];
      const hits = all.filter((hit) => !have.has(hit.set.id));
      // The set the card names most clearly. If that one is already in the binders, there is nothing to offer.
      const named = all.find((hit) => hit.sure);
      const top = named && !have.has(named.set.id) ? named : undefined;
      if (top) {
        setSaid(true);
        setOthers(hits.filter((hit) => hit.sure && hit.score >= top.score - 0.3).slice(0, 3));
        // The small print on a card's back throws up chance matches with other
        // players. The card has said who it is, so keep only that player.
        best = best.filter((c) => fold(c.card.p) === fold(top.cardName));
        setFound(best);
        if (best.length === 0) setProblem('That card is not in your sets yet. Tap its set below to add it.');
      } else if (best.length === 0 && hits.length > 0) {
        setOthers(hits);
        setProblem('That card is not in your sets yet. It is in the sets below: tap the right one to add it. The back of the card usually says which.');
      } else if (best.length === 0) {
        setProblem('That card is not in the sets on this device. Look for its set below, try the back of the card (plainer lettering), or type the name.');
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

  /** Takes over the front of a card that was identified from its back: a picture only, nothing is read. */
  const pictureOnly = (source: HTMLCanvasElement, margin: number) => {
    const flat = straighten(source, 1000, margin);
    cardRef.current = flat.canvas;
    setFlattened(flat.found);
    setTooClose(flat.tooClose);
    setShot(flat.canvas.toDataURL('image/jpeg', 0.75));
    keptRef.current = null;
    setSide(null);
    setFrontTaken(true);
  };

  /** Holds on to the side just scanned and opens the camera again for the other one. */
  const otherSide = (next: 'back' | 'front') => {
    if (!cardRef.current || !shot) return;
    keptRef.current = { canvas: cardRef.current, text: textRef.current, url: shot, flat: flattened };
    setSide(next);
    setShot(null);
    if (next === 'back') {
      setFound(null);
      setOthers(null);
      setProblem('');
    }
  };

  /** Gives up on the second shot and goes back to the first. */
  const keepFirstSide = () => {
    const kept = keptRef.current;
    if (kept) {
      setShot(kept.url);
      setFlattened(kept.flat);
    }
    keptRef.current = null;
    setSide(null);
  };

  const capture = () => {
    const video = videoRef.current;
    const view = viewRef.current;
    const guide = guideRef.current;
    if (!video || !view || !guide || video.videoWidth === 0) return;
    const single = grid === 1 || side !== null;
    const rect = guideCrop(view.getBoundingClientRect(), guide.getBoundingClientRect(), video.videoWidth, video.videoHeight, zoom, single ? MARGIN : 0.02);
    if (side === 'front') pictureOnly(cropFrame(video, rect), MARGIN / (1 + MARGIN * 2));
    else if (!single) void readGrid(cropFrame(video, rect), grid, 0.02 / 1.04);
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
      if (side === 'front') pictureOnly(toCanvas(bitmap, 2000), 0);
      else if (grid > 1 && side === null) await readGrid(toCanvas(bitmap, 4200), grid, 0);
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
    keptRef.current = null;
    setSide(null);
    setFrontTaken(false);
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
  // A front that left the set in doubt: its back can be read without losing the front picture.
  const canTurn = shot !== null && side === null && !picked && !busy && !batch && !query.trim() && found !== null && !looksLikeBack(textRef.current);
  // A card identified from its back: the front makes the better picture.
  const backShot = picked !== null && shot !== null && !frontTaken && !query.trim() && looksLikeBack(textRef.current);
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
          {shot && !busy && !batch ? <div className="viewfinder-tag">{flattened ? 'Straightened' : tooClose ? 'Too close to crop: leave a little space all round' : 'Edges not found, cropped to the frame'}</div> : null}
          {!shot && !busy && side ? <div className="viewfinder-tag">{side === 'back' ? 'Now the back of the same card' : 'Now the front of the same card'}</div> : null}
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
            {side === 'front' ? (
              <>
                <p className="panel-note">Show the front of this card. Only the picture is taken; the match stays as it is.</p>
                <div className="row-buttons">
                  <button type="button" className="btn btn-red btn-big" onClick={capture} disabled={camera !== 'live'}>
                    TAKE PICTURE
                  </button>
                  <label className="btn btn-big btn-file">
                    USE A PHOTO
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => void onPhoto(e.target.files?.[0])} />
                  </label>
                </div>
                <button type="button" className="link-plain" onClick={keepFirstSide}>
                  Keep the back as the picture
                </button>
              </>
            ) : (
              <>
                <div className="row-buttons">
                  <button type="button" className="btn btn-red btn-big" onClick={confirm}>
                    ADD TO BINDER
                  </button>
                  <button type="button" className="btn btn-big" onClick={() => setPicked(null)}>
                    NOT THIS
                  </button>
                </div>
                {backShot ? (
                  <>
                    <p className="panel-note">That was the back of the card, so the back is the picture that will be kept.</p>
                    <button type="button" className="btn" onClick={() => otherSide('front')}>
                      PICTURE THE FRONT INSTEAD
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <>
            {typeMode ? null : (
              <>
                <div className="row-buttons">
                  <button type="button" className="btn btn-red btn-big" onClick={shot ? reset : capture} disabled={busy || (!shot && camera !== 'live')}>
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
                {side === 'back' && !shot ? (
                  <p className="panel-note">
                    Show the back of the same card. It is only read to find the set; the front stays as the picture.{' '}
                    <button type="button" className="link-plain" onClick={keepFirstSide}>
                      Go back
                    </button>
                  </p>
                ) : null}
                {!shot && side === null ? <p className="mono-note">First card from a new set? Scan its back first: the back prints the set's name, and the app will offer to take the front for the picture.</p> : null}
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

            {canTurn && !(found && found.length > 0) ? (
              <button type="button" className="btn" onClick={() => otherSide('back')}>
                SCAN THE BACK OF THIS CARD
              </button>
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

            {canTurn && found && found.length > 0 ? (
              <button type="button" className="link-plain" onClick={() => otherSide('back')}>
                Wrong set? Scan the back of this card
              </button>
            ) : null}

            {canLook ? (
              <div className="field">
                <div className="field-label">Not listed? Find its set and add it</div>
                <div className="chips" role="group" aria-label="Kind of card">
                  {CATEGORIES.filter((c) => c.source === 'catalogue').map((c) => (
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
