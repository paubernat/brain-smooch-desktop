// Hash router: #manual, #agentica, #probar ("Probar política"), #calibracion
// (landing scrolled to the calibration card), #webs (block extra sites),
// #canales (channel lists), #configurar (setup screen even after launch),
// #custodio (custodian + password, right before the rocket), #candado
// (unlock / lock settings), #kit (printable recovery kit); anything else is
// the landing screen (the dashboard once launched).

export type Route = 'landing' | 'setup' | 'manual' | 'agentic' | 'test' | 'calibration' | 'sites' | 'channels' | 'custodian' | 'lock' | 'kit';

const HASHES: Record<Route, string> = {
  landing: '',
  setup: '#configurar',
  manual: '#manual',
  agentic: '#agentica',
  test: '#probar',
  calibration: '#calibracion',
  sites: '#webs',
  channels: '#canales',
  custodian: '#custodio',
  lock: '#candado',
  kit: '#kit',
};

const BY_HASH = new Map<string, Route>(
  (Object.entries(HASHES) as [Route, string][]).filter(([, hash]) => hash).map(([route, hash]) => [hash, route]),
);

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '#').toLowerCase();
  return BY_HASH.get(clean) ?? 'landing';
}

export function hrefFor(route: Route): string {
  return HASHES[route] || '#';
}

export function go(route: Route): void {
  location.hash = hrefFor(route);
}

export function currentRoute(): Route {
  return parseRoute(location.hash);
}

export function onRouteChange(render: (route: Route) => void): void {
  window.addEventListener('hashchange', () => render(currentRoute()));
  render(currentRoute());
}
