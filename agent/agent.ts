import { registerHarnessProfile } from "deepagents";
import { modelCallLimitMiddleware } from "langchain";
import { defineDeepAgent, type ManagedServerRuntime } from "managed-deepagents";
import { z } from "zod";

import { accessMiddleware, accessPolicy } from "./access.js";
import { chooseModel, createModel, MODEL_CHOICES } from "./model.js";

// Docs searches must stay in the root trace, where evaluators read them; the built-in
// general-purpose subagent would run them out of sight. managed-deepagents also adds an async
// general-purpose subagent that ignores `enabled: false`, so its tools and the then-empty `task`
// tool are excluded too.
const SUBAGENT_TOOLS = [
  "task",
  "start_async_task",
  "check_async_task",
  "update_async_task",
  "cancel_async_task",
  "list_async_tasks",
];
for (const provider of ["anthropic", "openai"]) {
  registerHarnessProfile(provider, {
    generalPurposeSubagent: { enabled: false },
    excludedTools: SUBAGENT_TOOLS,
  });
}

// Lets an eval run pick the model. Real users never set it, so they always get the default.
export const contextSchema = z.object({ eval_model: z.enum(MODEL_CHOICES).optional() });

// A factory, so the model is chosen per run and summarization inherits it too.
export function agent(runtime: ManagedServerRuntime) {
  return defineDeepAgent({
    // Also the assistant id and tracing project prefix; the web app hardcodes it.
    name: "chat-langchain-lite",
    model: createModel(process.env, chooseModel(runtime.executionRuntime?.context?.eval_model)),
    contextSchema,
    middleware: [
      accessMiddleware(accessPolicy(process.env)),
      modelCallLimitMiddleware({ runLimit: 25, exitBehavior: "end" }),
    ],
  });
}
