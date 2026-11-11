import { Screen } from '../components/Chrome';
import { href } from '../lib/router';

export function NotFound() {
  return (
    <Screen>
      <div className="empty">
        <h1 className="display-l">NOT HERE</h1>
        <p>That set or card is not in the app.</p>
        <a className="btn btn-ink" href={href([])}>
          Back to binders
        </a>
      </div>
    </Screen>
  );
}
