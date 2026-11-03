import { describe, expect, it } from "vitest";

import { check, issueAction, judgeProblem, renderReport, spendProblems } from "../src/health.ts";

const pass = { name: "Pages", ok: true, detail: "up" };
const fail = { name: "Engine", ok: false, detail: "scanning is paused" };

describe("check", () => {
  it("turns a throw into a failed result", async () => {
    expect(await check("Pages", async () => "up")).toEqual(pass);
    expect(
      await check("Engine", async () => {
        throw new Error("scanning is paused");
      }),
    ).toEqual(fail);
  });
});

describe("issueAction", () => {
  it("keeps one issue open while anything fails", () => {
    expect(issueAction(null, [pass, fail])).toEqual({ kind: "open" });
    expect(issueAction(12, [pass, fail])).toEqual({ kind: "comment", issue: 12 });
  });

  it("closes the issue once everything passes", () => {
    expect(issueAction(12, [pass])).toEqual({ kind: "close", issue: 12 });
    expect(issueAction(null, [pass])).toEqual({ kind: "none" });
  });
});

describe("renderReport", () => {
  it("lists every check with its outcome", () => {
    expect(renderReport([pass, fail])).toBe(
      "- ✅ **Pages**: up\n- ❌ **Engine**: scanning is paused",
    );
  });
});

describe("spendProblems", () => {
  const spend = { projectLcu: 40, projectLimitLcu: 250, orgLcu: 1000, orgLimitLcu: 2500 };

  it("passes spend well under both limits", () => {
    expect(spendProblems(spend)).toEqual([]);
  });

  it("fails when the project hit its limit or the org is close to its own", () => {
    expect(spendProblems({ ...spend, projectLcu: 250 })).toHaveLength(1);
    expect(spendProblems({ ...spend, orgLcu: 2400 })).toEqual([
      "the org has used 2400 of its 2500 LCU",
    ]);
  });

  it("ignores limits that aren't set", () => {
    expect(
      spendProblems({ projectLcu: 900, projectLimitLcu: null, orgLcu: 9000, orgLimitLcu: null }),
    ).toEqual([]);
  });
});

describe("judgeProblem", () => {
  const now = new Date("2026-11-03T18:00:00Z");

  it("passes while the judge scored within the last 12 hours", () => {
    expect(judgeProblem("2026-11-03T17:44:57.588290", now)).toBeNull();
    expect(judgeProblem("2026-11-03T07:00:00Z", now)).toBeNull();
  });

  it("reads LangSmith's offset-less timestamps as UTC", () => {
    expect(judgeProblem("2026-11-03T05:00:00", now)).toBe(
      "last scored a production trace 13 hours ago",
    );
  });

  it("fails when the judge never scored", () => {
    expect(judgeProblem(null, now)).toBe("has never scored a production trace");
  });
});
