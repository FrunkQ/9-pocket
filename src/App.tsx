import { useEffect } from 'react';
import { useProductsReady } from './data/catalog';
import { refreshRates, useCurrencyVersion } from './lib/currency';
import { useRoute } from './lib/router';
import { binderIds, openOnFavourite, useCollection } from './lib/store';
import { AddSet } from './screens/AddSet';
import { CardDetail } from './screens/CardDetail';
import { CompareFriend, Friends, OpenShared } from './screens/Friends';
import { Home } from './screens/Home';
import { ImportSet } from './screens/ImportSet';
import { Missing } from './screens/Missing';
import { Loading, NotFound } from './screens/NotFound';
import { Scan } from './screens/Scan';
import { SetBinder } from './screens/SetBinder';
import { Settings } from './screens/Settings';

export function App() {
  const route = useRoute();
  const state = useCollection();
  const ready = useProductsReady(binderIds(state));
  // Values are redrawn when the display currency or its rates change.
  useCurrencyVersion();
  const currency = state.settings.currency;
  useEffect(() => {
    if (currency !== 'USD') void refreshRates();
  }, [currency]);
  // The app opens on whichever kind of card is used most.
  useEffect(() => openOnFavourite(), []);
  const [first, second, third] = route.parts;
  const path = route.parts.join('/');

  // Each screen starts at the top, like a page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  // The sets in the user's binders are read from the device before anything is shown.
  if (!ready) return <Loading />;

  if (!first) return <Home />;
  if (first === 'add') return <AddSet route={route} />;
  if (first === 'import') return <ImportSet route={route} />;
  if (first === 'settings') return <Settings route={route} />;
  if (first === 'set' && third === 'missing') return <Missing route={route} />;
  if (first === 'set') return <SetBinder route={route} />;
  if (first === 'card') return <CardDetail route={route} />;
  if (first === 'scan') return <Scan key={route.query.get('mode') ?? 'camera'} route={route} />;
  if (first === 'friends' && second === 'open') return <OpenShared route={route} />;
  if (first === 'friends' && second) return <CompareFriend route={route} />;
  if (first === 'friends') return <Friends />;
  return <NotFound />;
}
