// Hash routes, because GitHub Pages has no SPA fallback: #/<environment>[/t/<threadId>]
export interface Route {
  readonly environment: string | null;
  readonly threadId: string | null;
}

export function parseRoute(hash: string): Route {
  const [environment = null, marker, threadId] = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  return { environment, threadId: marker === "t" && threadId ? threadId : null };
}

export function formatRoute(route: Route): string {
  const segments = [route.environment, route.threadId && `t/${route.threadId}`].filter(Boolean);
  return `#/${segments.join("/")}`;
}
