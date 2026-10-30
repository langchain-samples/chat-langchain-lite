import { describe, expect, it } from "vite-plus/test";

import {
  agentKeyHeaders,
  apiKeyHeaders,
  clearPat,
  keyOwnerId,
  loadPat,
  savePat,
  verifyPat,
} from "./pat";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const fetchReturning = (status: number) =>
  (async () => new Response("{}", { status })) as typeof fetch;

describe("PAT storage", () => {
  it("saves trimmed, loads, and clears", () => {
    const store = memoryStore();
    savePat(store, "  lsv2_pt_abc \n");
    expect(loadPat(store)).toBe("lsv2_pt_abc");
    clearPat(store);
    expect(loadPat(store)).toBeNull();
  });
});

describe("key headers", () => {
  it("sends the key and the deployment workspace", () => {
    expect(apiKeyHeaders("k", "ws")).toEqual({ "x-api-key": "k", "X-Tenant-Id": "ws" });
  });

  it("routes a key through the platform scheme, since the agent itself takes only OAuth tokens", () => {
    expect(agentKeyHeaders("k", "ws")).toMatchObject({ "x-auth-scheme": "langsmith" });
  });
});

describe("keyOwnerId", () => {
  it("returns the LangSmith user id the agent owns threads under", async () => {
    const fetchFn = (async () =>
      Response.json({ user_id: "identity", ls_user_id: "user" })) as typeof fetch;
    expect(await keyOwnerId(fetchFn, "k", "ws")).toBe("user");
  });

  it("fails for a key LangSmith rejects", async () => {
    await expect(keyOwnerId(fetchReturning(401), "k", "ws")).rejects.toThrow(/401/);
  });
});

describe("verifyPat", () => {
  it("accepts a 200 from the agent", async () => {
    expect(await verifyPat(fetchReturning(200), "https://a", {})).toEqual({ ok: true });
  });

  it("explains workspace mismatches and network failures", async () => {
    const forbidden = await verifyPat(fetchReturning(403), "https://a", {});
    expect(forbidden.ok).toBe(false);
    expect(!forbidden.ok && forbidden.message).toMatch(/workspace/);

    const unreachable = await verifyPat(
      (async () => Promise.reject(new TypeError("x"))) as typeof fetch,
      "https://a",
      {},
    );
    expect(!unreachable.ok && unreachable.message).toMatch(/reach/);
  });
});
