import type { Api } from "../src/api.ts";

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly query?: unknown;
}

/** An in-memory Api whose responses come from `respond`, recording every call. */
export function fakeApi(respond: (call: Call) => unknown): Api & { calls: Call[] } {
  const calls: Call[] = [];
  const handle = async (call: Call) => {
    calls.push(call);
    return respond(call);
  };
  return {
    calls,
    get: (path, query) => handle({ method: "GET", path, query }) as never,
    post: (path, body) => handle({ method: "POST", path, body }) as never,
    patch: (path, body) => handle({ method: "PATCH", path, body }) as never,
    put: (path, body) => handle({ method: "PUT", path, body }) as never,
    delete: (path, query) => handle({ method: "DELETE", path, query }) as never,
  };
}
