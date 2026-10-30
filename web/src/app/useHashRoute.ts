import { useCallback, useSyncExternalStore } from "react";

import { formatRoute, parseRoute, type Route } from "./route";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function useHashRoute(): [Route, (next: Route, options?: { replace?: boolean }) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const target = formatRoute(next);
    if (target === window.location.hash) return;
    if (options?.replace) {
      window.history.replaceState(null, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = target;
    }
  }, []);
  return [parseRoute(hash), navigate];
}
