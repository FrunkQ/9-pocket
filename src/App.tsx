import { useEffect } from 'react';
import { useRoute } from './lib/router';
import { CardDetail } from './screens/CardDetail';
import { Home } from './screens/Home';
import { Missing } from './screens/Missing';
import { NotFound } from './screens/NotFound';
import { Scan } from './screens/Scan';
import { SetBinder } from './screens/SetBinder';

export function App() {
  const route = useRoute();
  const [first, , third] = route.parts;
  const path = route.parts.join('/');

  // Each screen starts at the top, like a page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (!first) return <Home />;
  if (first === 'set' && third === 'missing') return <Missing route={route} />;
  if (first === 'set') return <SetBinder route={route} />;
  if (first === 'card') return <CardDetail route={route} />;
  if (first === 'scan') return <Scan key={route.query.get('mode') ?? 'camera'} route={route} />;
  return <NotFound />;
}
