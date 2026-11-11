// Team colours for the plain card faces shown until real card images exist,
// plus the words that help recognise a team in text read off a card.

interface Team {
  bg: string;
  fg: string;
  words: string[];
}

const LIGHT = '#FFFFFF';
const DARK = '#111417';

export const TEAMS: Record<string, Team> = {
  ANA: { bg: '#CF4520', fg: LIGHT, words: ['anaheim', 'ducks'] },
  ARI: { bg: '#8C2633', fg: LIGHT, words: ['arizona', 'coyotes'] },
  ATL: { bg: '#041E42', fg: LIGHT, words: ['atlanta', 'thrashers'] },
  BOS: { bg: '#FFB81C', fg: DARK, words: ['boston', 'bruins'] },
  BUF: { bg: '#003087', fg: LIGHT, words: ['buffalo', 'sabres'] },
  CGY: { bg: '#C8102E', fg: LIGHT, words: ['calgary', 'flames'] },
  CAR: { bg: '#CC0000', fg: LIGHT, words: ['carolina', 'hurricanes'] },
  CHI: { bg: '#CF0A2C', fg: LIGHT, words: ['chicago', 'blackhawks'] },
  COL: { bg: '#6F263D', fg: LIGHT, words: ['colorado', 'avalanche'] },
  CBJ: { bg: '#002654', fg: LIGHT, words: ['columbus', 'jackets'] },
  DAL: { bg: '#006847', fg: LIGHT, words: ['dallas', 'stars'] },
  DET: { bg: '#CE1126', fg: LIGHT, words: ['detroit', 'wings'] },
  EDM: { bg: '#041E42', fg: LIGHT, words: ['edmonton', 'oilers'] },
  FLA: { bg: '#041E42', fg: LIGHT, words: ['florida', 'panthers'] },
  LAK: { bg: '#111111', fg: LIGHT, words: ['angeles', 'kings'] },
  MIN: { bg: '#154734', fg: LIGHT, words: ['minnesota', 'wild'] },
  MTL: { bg: '#AF1E2D', fg: LIGHT, words: ['montreal', 'canadiens'] },
  NSH: { bg: '#FFB81C', fg: DARK, words: ['nashville', 'predators'] },
  NJD: { bg: '#CE1126', fg: LIGHT, words: ['jersey', 'devils'] },
  NYI: { bg: '#00539B', fg: LIGHT, words: ['islanders'] },
  NYR: { bg: '#0038A8', fg: LIGHT, words: ['rangers'] },
  OTT: { bg: '#C52032', fg: LIGHT, words: ['ottawa', 'senators'] },
  PHI: { bg: '#D24303', fg: LIGHT, words: ['philadelphia', 'flyers'] },
  PIT: { bg: '#1A1A1A', fg: '#FCB514', words: ['pittsburgh', 'penguins'] },
  SJS: { bg: '#006D75', fg: LIGHT, words: ['jose', 'sharks'] },
  SEA: { bg: '#001628', fg: LIGHT, words: ['seattle', 'kraken'] },
  STL: { bg: '#002F87', fg: LIGHT, words: ['louis', 'blues'] },
  TBL: { bg: '#002868', fg: LIGHT, words: ['tampa', 'lightning'] },
  TOR: { bg: '#00205B', fg: LIGHT, words: ['toronto', 'leafs'] },
  UTA: { bg: '#6CACE4', fg: DARK, words: ['utah', 'mammoth'] },
  VAN: { bg: '#00843D', fg: LIGHT, words: ['vancouver', 'canucks'] },
  VGK: { bg: '#B4975A', fg: DARK, words: ['vegas', 'knights'] },
  WSH: { bg: '#C8102E', fg: LIGHT, words: ['washington', 'capitals'] },
  WPG: { bg: '#004C97', fg: LIGHT, words: ['winnipeg', 'jets'] },
};

const FALLBACK: Team = { bg: '#4A5055', fg: LIGHT, words: [] };

/** Colours for a team abbreviation; two-team cards use the first team. */
export function teamColors(abbr: string): Team {
  return TEAMS[abbr.split('/')[0]] ?? FALLBACK;
}
