export type FetchFn = typeof fetch;

export interface Api {
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`${status} ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export function createApi(options: {
  baseUrl: string;
  apiKey: string;
  workspaceId: string;
  headers?: Readonly<Record<string, string>>;
  fetchFn?: FetchFn;
}): Api {
  const { baseUrl, apiKey, workspaceId, fetchFn = fetch } = options;
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-tenant-id": workspaceId,
    ...options.headers,
  };

  async function request<T>(method: string, path: string, body?: unknown, query?: object) {
    const url = new URL(baseUrl.replace(/\/$/, "") + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetchFn(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, path, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path, query) => request("DELETE", path, undefined, query),
  };
}
