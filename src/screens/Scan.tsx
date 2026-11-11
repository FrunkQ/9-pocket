import { useEffect, useMemo, useRef, useState } from 'react';
import { CardFace } from '../components/CardFace';
import { Tick } from '../components/Chrome';
import { baseCount, cardKey, getProduct, versionsFor } from '../data/catalog';
import { cropFrame, guideCrop, keepFocusing, openCamera, preferredCamera, rearCameras, refocus } from '../lib/capture';
import { estimate, money } from '../lib/estimate';
import { matchText, searchCards, type Candidate } from '../lib/match';
import { readText, toCanvas, warmUp } from '../lib/ocr';
import { savePhoto } from '../lib/photos';
import { href, type Route } from '../lib/router';
import { straighten } from '../lib/straighten';
import { addCopy, copiesByCard, updateSettings, useCollection } from '../lib/store';

type Camera = 'starting' | 'live' | 'blocked' | 'off';

const ZOOMS = [1, 1.5, 2, 3];
/** Spare border captured around the guide so the card's edges are in the picture. */
const MARGIN = 0.08;

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
  const cameraId = state.settings.cameraId;

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cardRef = useRef<HTMLCanvasElement | null>(null);
  const autoPicked = useRef(false);

  const [camera, setCamera] = useState<Camera>(typeMode ? 'off' : 'starting');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [zoom, setZoom] = useState(2);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [flattened, setFlattened] = useState(false);
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
    setProblem('');
    setFound(null);
    setAdded('');
    try {
      const flat = straighten(source, 1000, margin);
      cardRef.current = flat.canvas;
      setFlattened(flat.found);
      setShot(flat.canvas.toDataURL('image/jpeg', 0.75));
      const text = await readText(flat.canvas);
      const candidates = matchText(text, { preferProduct: prefer });
      setFound(candidates);
      if (candidates.length === 0) setProblem('No player name could be read. Try again with the card filling the frame, or type the name below.');
    } catch {
      setProblem('The text reader could not load. Check your connection, or type the name below.');
    } finally {
      setBusy(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const view = viewRef.current;
    const guide = guideRef.current;
    if (!video || !view || !guide || video.videoWidth === 0) return;
    const rect = guideCrop(view.getBoundingClientRect(), guide.getBoundingClientRect(), video.videoWidth, video.videoHeight, zoom, MARGIN);
    void read(cropFrame(video, rect), MARGIN / (1 + MARGIN * 2));
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      await read(toCanvas(bitmap, 2000), 0);
    } catch {
      setProblem('That photo could not be opened.');
    }
  };

  const tapFocus = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track && !shot) void refocus(track);
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
    cardRef.current = null;
  };

  const confirm = () => {
    if (!picked) return;
    const copy = addCopy({ product: picked.product.id, section: picked.section.id, n: picked.card.n, version });
    const key = cardKey(picked.product.id, picked.section.id, picked.card.n);
    if (cardRef.current) void savePhoto(copy.id, key, cardRef.current);
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
        <div className="viewfinder" ref={viewRef} onClick={tapFocus}>
          <video ref={videoRef} playsInline muted className={shot ? 'is-hidden' : ''} style={{ transform: `scale(${zoom})` }} />
          {shot ? <img src={shot} alt="The card as it will be saved" /> : null}
          {camera === 'live' && !shot ? (
            <div className="guide" ref={guideRef} aria-hidden="true">
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
          {shot && !busy ? <div className="viewfinder-tag">{flattened ? 'Straightened' : 'Edges not found, cropped to the frame'}</div> : null}
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
                <CardFace card={picked.card} photo={shot ?? undefined} />
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
                {camera === 'live' && !shot ? <p className="mono-note">Blurry? Hold the phone further back and zoom in. Tap the picture to refocus.</p> : null}
              </>
            )}

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
