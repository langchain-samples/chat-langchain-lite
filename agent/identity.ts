import { defineIdentity } from "managed-deepagents";

// "Sign in with LangSmith" tokens; access.ts limits them to our org and app. API keys still work
// through the platform scheme (`x-auth-scheme: langsmith`). mda parses this statically: literals only.
export const identity = defineIdentity({
  auth: {
    issuer: "https://api.smith.langchain.com",
    jwks: "https://api.smith.langchain.com/.well-known/jwks.json",
    audience: "https://api.smith.langchain.com",
    algorithms: ["EdDSA"],
    claims: { user: "sub" },
  },
});
