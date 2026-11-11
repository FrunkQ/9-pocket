import { useEffect, useRef, useState } from 'react';
import { BackButton, Screen } from '../components/Chrome';
import { CardFace } from '../components/CardFace';
import { cardKey, useProductsReady } from '../data/catalog';
import { photoCount, photoFor, usePhotoVersion } from '../lib/photos';
import { go, href, type Route } from '../lib/router';
import { buildShareFile, compare, decodeShare, encodeShare, friendPhotoKey, parseShareFile, removeFriend, saveFriend, shareUrl, tokenFromLink, useFriends, type TradeCard } from '../lib/share';
import { isOwnPhoto, saveFile, updateSettings, useCollection } from '../lib/store';
import { Loading, NotFound } from './NotFound';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Share your collection, and open collections other people have sent. */
export function Friends() {
  const state = useCollection();
  const friends = useFriends();
  usePhotoVersion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [withPhotos, setWithPhotos] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const photos = photoCount(isOwnPhoto);
  const name = state.settings.name;
  const count = state.copies.length;

  const sendLink = async () => {
    const url = shareUrl(await encodeShare(name, state.copies));
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name || 'My'} Nine Pocket collection`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage('Link copied. Paste it into a message to your friend.');
    } catch {
      setMessage('');
    }
  };

  const sendFile = async () => {
    const text = await buildShareFile(name, state.copies, withPhotos && photos > 0);
    const fileName = `nine-pocket-${(name || 'collection').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    try {
      const file = new File([text], fileName, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${name || 'My'} Nine Pocket collection`, files: [file] });
        return;
      }
    } catch {
      return; // Share sheet dismissed.
    }
    saveFile(fileName, text);
    setMessage('File saved. Send it to your friend however you like.');
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const friend = await saveFriend(parseShareFile(await file.text()));
      go(['friends', friend.id]);
    } catch {
      setMessage('That file is not a Nine Pocket collection.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const openLink = () => {
    const token = tokenFromLink(link);
    if (!token) {
      setMessage('That does not look like a Nine Pocket link.');
      return;
    }
    go(['friends', 'open'], { d: token });
  };

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href([])} label="Back to binders" />
          <div>
            <h1 className="display-l">COMPARE</h1>
            <div className="sub">Swap collections with a friend and see who has what</div>
          </div>
        </div>
      </header>

      <section className="panel panel-first" aria-labelledby="send-title">
        <h2 id="send-title" className="eyebrow">
          SEND YOURS
        </h2>
        <label className="field">
          <span className="field-label">Your name, so they know whose it is</span>
          <input type="text" value={name} onChange={(e) => updateSettings({ name: e.target.value })} placeholder="e.g. Alex" autoComplete="given-name" maxLength={40} />
        </label>
        <p className="panel-text">
          {count === 0 ? 'You have no cards yet, so there is nothing to send.' : `This sends the list of your ${count} cards. A link carries the list only; a file can carry your card photos too.`}
        </p>
        {photos > 0 ? (
          <label className="check">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            <span>Put my {photos} card photos in the file</span>
          </label>
        ) : null}
        <div className="row-buttons">
          <button type="button" className="btn btn-ink" onClick={() => void sendLink()} disabled={count === 0}>
            Share a link
          </button>
          <button type="button" className="btn" onClick={() => void sendFile()} disabled={count === 0}>
            Share a file
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="open-title">
        <h2 id="open-title" className="eyebrow">
          OPEN A FRIEND'S
        </h2>
        <p className="panel-text">Opening a link they sent brings you straight here. You can also paste the link, or open a file.</p>
        <label className="field">
          <span className="field-label">Paste their link</span>
          <input type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" autoComplete="off" />
        </label>
        <div className="row-buttons">
          <button type="button" className="btn btn-ink" onClick={openLink} disabled={!link.trim()}>
            Open link
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Open a file
          </button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void openFile(e.target.files?.[0])} />
        {message ? (
          <p className="panel-note" role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="friends-list-title">
        <h2 id="friends-list-title" className="eyebrow">
          FRIENDS ON THIS DEVICE
        </h2>
        {friends.length === 0 ? (
          <p className="panel-text">None yet.</p>
        ) : (
          <ul className="rows">
            {friends.map((f) => (
              <li key={f.id} className="row">
                <a className="row-main" href={href(['friends', f.id])}>
                  <span className="row-name">
                    {f.name}{' '}
                    <small>
                      {f.copies.length} cards · received {when(f.received)}
                    </small>
                  </span>
                </a>
                <button type="button" className="row-buy" onClick={() => removeFriend(f.id)} aria-label={`Remove ${f.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

/** Lands here from a shared link: saves the collection, then shows the comparison. */
export function OpenShared({ route }: { route: Route }) {
  const token = route.query.get('d') ?? '';
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    decodeShare(token)
      .then(saveFriend)
      .then((friend) => window.location.replace(href(['friends', friend.id])))
      .catch(() => setFailed(true));
  }, [token]);

  return (
    <Screen>
      <div className="empty">
        <h1 className="display-l">{failed ? 'LINK NOT READABLE' : 'OPENING…'}</h1>
        {failed ? <p>That link is incomplete or damaged. Ask your friend to send it again, or to send a file instead.</p> : null}
        <a className="btn btn-ink" href={href(['friends'])}>
          Share and compare
        </a>
      </div>
    </Screen>
  );
}

function TradeList({ title, note, cards, friendId, empty }: { title: string; note: string; cards: TradeCard[]; friendId?: string; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, 40);
  return (
    <section className="trade" aria-label={title}>
      <div className="versions-head">
        <h2 className="eyebrow">
          {title} · {cards.length}
        </h2>
        <span className="mono-note">{note}</span>
      </div>
      {cards.length === 0 ? <p className="panel-text trade-empty">{empty}</p> : null}
      <ul className="rows">
        {shown.map(({ product, section, card, held }) => {
          const key = cardKey(product.id, section.id, card.n);
          const photo = friendId ? photoFor(friendPhotoKey(friendId, key)) : photoFor(key);
          return (
            <li key={key} className="row">
              <a className="row-main" href={href(['card', product.id, section.id, card.n])}>
                <span className="row-thumb">
                  <CardFace card={card} photo={photo?.thumb} />
                </span>
                <span className="row-no">{card.n}</span>
                <span className="row-name">
                  {card.p || 'Card'}{' '}
                  <small>
                    {card.t} · {product.name} {product.season}
                  </small>
                </span>
                <span className={held > 1 ? 'tag tag-on' : 'tag'}>{held > 1 ? `spare ×${held - 1}` : 'only copy'}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {cards.length > shown.length ? (
        <button type="button" className="link-plain" onClick={() => setAll(true)}>
          Show all {cards.length}
        </button>
      ) : null}
    </section>
  );
}

export function CompareFriend({ route }: { route: Route }) {
  const state = useCollection();
  const friends = useFriends();
  usePhotoVersion();
  const friend = friends.find((f) => f.id === route.parts[1]);
  // Their sets may not be on this device yet; fetch them before comparing.
  const ready = useProductsReady((friend?.copies ?? []).map((c) => c.product));
  if (!friend) return <NotFound />;
  if (!ready) return <Loading what="LOADING THEIR SETS…" />;

  const result = compare(state.copies, friend.copies);
  const spareIn = result.theyHave.filter((c) => c.held > 1).length;
  const spareOut = result.youHave.filter((c) => c.held > 1).length;

  return (
    <Screen>
      <header className="set-head">
        <div className="set-head-title">
          <BackButton to={href(['friends'])} label="Back to share and compare" />
          <div>
            <h1 className="display-l">{friend.name.toUpperCase()}</h1>
            <div className="sub">
              {friend.copies.length} cards · received {when(friend.received)}
            </div>
          </div>
        </div>
      </header>

      <div className="hero">
        <div>
          <div className="eyebrow eyebrow-light">SPARES YOU COULD SWAP</div>
          <div className="display-xl">
            {spareIn}
            <span className="dim"> ⇄ </span>
            {spareOut}
          </div>
          <div className="hero-sub">
            {friend.name} has {spareIn} spare {spareIn === 1 ? 'card' : 'cards'} you need; you have {spareOut} they need. You both hold {result.both} of the same cards.
          </div>
        </div>
      </div>

      <p className="mono-note legend">Only the numbered base sets are compared, and only sets each person has started. This is their collection as of {when(friend.received)}; ask for a fresh link to update it.</p>

      <TradeList title={`${friend.name.toUpperCase()} HAS, YOU NEED`} note="spares first" cards={result.theyHave} friendId={friend.id} empty="Nothing they hold is missing from your binders." />
      <TradeList title={`YOU HAVE, ${friend.name.toUpperCase()} NEEDS`} note="spares first" cards={result.youHave} empty="Nothing you hold is missing from theirs." />
    </Screen>
  );
}
