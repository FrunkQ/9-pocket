import { useEffect } from 'react';
import { useProductsReady } from './data/catalog';
import { useRoute } from './lib/router';
import { binderIds, useCollection } from './lib/store';
import { AddSet } from './screens/AddSet';
import { CardDetail } from './screens/CardDetail';
import { CompareFriend, Friends, OpenShared } from './screens/Friends';
import { Home } from './screens/Home';
import { Missing } from './screens/Missing';
import { Loading, NotFound } from './screens/NotFound';
import { Scan } from './screens/Scan';
import { SetBinder } from './screens/SetBinder';

export function App() {
  const route = useRoute();
  const state = useCollection();
  const ready = useProductsReady(binderIds(state));
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
  if (first === 'set' && third === 'missing') return <Missing route={route} />;
  if (first === 'set') return <SetBinder route={route} />;
  if (first === 'card') return <CardDetail route={route} />;
  if (first === 'scan') return <Scan key={route.query.get('mode') ?? 'camera'} route={route} />;
  if (first === 'friends' && second === 'open') return <OpenShared route={route} />;
  if (first === 'friends' && second) return <CompareFriend route={route} />;
  if (first === 'friends') return <Friends />;
  return <NotFound />;
}
