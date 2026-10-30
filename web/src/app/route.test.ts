import { describe, expect, it } from "vite-plus/test";

import { formatRoute, parseRoute } from "./route";

describe("routes", () => {
  it("parses environment and thread", () => {
    expect(parseRoute("#/development/t/abc")).toEqual({
      environment: "development",
      threadId: "abc",
    });
    expect(parseRoute("#/production")).toEqual({ environment: "production", threadId: null });
    expect(parseRoute("")).toEqual({ environment: null, threadId: null });
  });

  it("round-trips", () => {
    const route = { environment: "production", threadId: "t-1" };
    expect(parseRoute(formatRoute(route))).toEqual(route);
    expect(formatRoute({ environment: null, threadId: null })).toBe("#/");
  });
});
