import type { ManagedServerInfo } from "managed-deepagents";
import { describe, expect, it } from "vitest";

import { accessPolicy, refusal } from "../access.js";

const policy = accessPolicy({ ALLOWED_ORGANIZATION_ID: "org-1", OAUTH_CLIENT_ID: "lsc_1" });

const oauthCaller = (claims: Record<string, unknown>) =>
  ({
    principal: { id: "u", kind: "person", claims },
    source: { provider: "http" },
  }) as unknown as ManagedServerInfo;

describe("refusal", () => {
  it("admits our app's tokens from our org", () => {
    expect(
      refusal(policy, oauthCaller({ organization_id: "org-1", client_id: "lsc_1" })),
    ).toBeNull();
  });

  it("refuses another org, and another app's tokens even from our org", () => {
    expect(refusal(policy, oauthCaller({ organization_id: "org-2", client_id: "lsc_1" }))).toMatch(
      /organization/,
    );
    expect(refusal(policy, oauthCaller({ organization_id: "org-1", client_id: "lsc_2" }))).toMatch(
      /Chat LangChain Lite/,
    );
  });

  it("refuses every token until the OAuth app's id is set", () => {
    const unset = accessPolicy({ ALLOWED_ORGANIZATION_ID: "org-1" });
    expect(refusal(unset, oauthCaller({ organization_id: "org-1" }))).not.toBeNull();
  });

  it("admits API-key callers the platform already checked, such as Studio and Engine", () => {
    const studio = {
      principal: { id: "u", kind: "person", claims: {} },
      source: { provider: "studio" },
    } as unknown as ManagedServerInfo;
    expect(refusal(policy, studio)).toBeNull();
  });
});
