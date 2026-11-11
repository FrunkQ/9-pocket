// NHL team nickname -> abbreviation, as the names appear in Upper Deck checklists.
const BY_NAME = {
  Ducks: 'ANA', Coyotes: 'ARI', Thrashers: 'ATL', Bruins: 'BOS', Sabres: 'BUF', Flames: 'CGY',
  Hurricanes: 'CAR', Blackhawks: 'CHI', Avalanche: 'COL', 'Blue Jackets': 'CBJ', Stars: 'DAL',
  'Red Wings': 'DET', Oilers: 'EDM', Panthers: 'FLA', Kings: 'LAK', Wild: 'MIN', Canadiens: 'MTL',
  Predators: 'NSH', Devils: 'NJD', Islanders: 'NYI', Rangers: 'NYR', Senators: 'OTT', Flyers: 'PHI',
  Penguins: 'PIT', Sharks: 'SJS', Kraken: 'SEA', Blues: 'STL', Lightning: 'TBL', 'Maple Leafs': 'TOR',
  Mammoth: 'UTA', 'Hockey Club': 'UTA', Canucks: 'VAN', 'Golden Knights': 'VGK', Capitals: 'WSH',
  Jets: 'WPG', Whalers: 'HFD', Nordiques: 'QUE', 'North Stars': 'MNS',
};

const unknown = new Set();

export function teamAbbr(city, team) {
  if (!team || team === 'NA' || team === 'TBD') return '';
  const parts = team.split('/').map((t) => t.trim());
  const abbrs = parts.map((t) => {
    const a = BY_NAME[t];
    if (!a) unknown.add(`${city} ${t}`);
    return a ?? '';
  });
  const unique = [...new Set(abbrs.filter(Boolean))];
  return unique.join('/');
}

export function unknownTeams() {
  return [...unknown];
}
