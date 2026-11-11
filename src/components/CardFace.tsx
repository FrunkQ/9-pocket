import type { Card } from '../types';
import { teamColors } from '../lib/teams';

/** Last name (or the last word of the card's subject), for the name strip. */
export function shortName(player: string): string {
  if (!player) return '';
  if (player.includes('/')) return player.split('/')[0].trim().split(' ').slice(-1)[0];
  const words = player.split(' ');
  if (words.length <= 1) return player;
  // Keep two-part surnames together: "Eriksson Ek", "van Riemsdyk", "St. Louis".
  const lowerLead = /^(van|von|de|del|st\.?|la|le|di|da|mac)$/i;
  if (words.length >= 3 && (lowerLead.test(words[words.length - 2]) || words[words.length - 1].length <= 3)) {
    return words.slice(-2).join(' ');
  }
  return words[words.length - 1];
}

/**
 * The plain card face used until real card images are available: team colour,
 * team code, name and number.
 */
export function CardFace({ card, size = 'pocket' }: { card: Card; size?: 'pocket' | 'large' }) {
  const team = teamColors(card.t);
  const code = card.t.split('/')[0] || '—';
  return (
    <div className={`face face-${size}`}>
      <div className="face-art" style={{ background: team.bg, color: team.fg }}>
        {card.rc ? <span className="face-flag">RC</span> : null}
        <span className="face-code">{code}</span>
      </div>
      <div className="face-strip">
        <span className="face-name">{shortName(card.p) || 'Card'}</span>
        <span className="face-no">{card.n}</span>
      </div>
    </div>
  );
}

/** An empty binder pocket: dark until the card is scanned. */
export function EmptyPocket({ card }: { card: Card }) {
  return (
    <div className="pocket-empty">
      <span className="pocket-no">{card.n}</span>
      <span className="pocket-who">
        {shortName(card.p) || 'Card'}
        <br />
        {card.t}
      </span>
    </div>
  );
}
