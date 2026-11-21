// Hash router: #manual, #agentica, anything else is the landing screen.

export type Route = 'landing' | 'manual' | 'agentic';

const HASHES: Record<Route, string> = { landing: '', manual: '#manual', agentic: '#agentica' };

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '#').toLowerCase();
  if (clean === HASHES.manual) return 'manual';
  if (clean === HASHES.agentic) return 'agentic';
  return 'landing';
}

export function hrefFor(route: Route): string {
  return HASHES[route] || '#';
}

export function go(route: Route): void {
  location.hash = hrefFor(route);
}

export function onRouteChange(render: (route: Route) => void): void {
  window.addEventListener('hashchange', () => render(parseRoute(location.hash)));
  render(parseRoute(location.hash));
}
