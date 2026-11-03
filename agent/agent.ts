import { registerHarnessProfile } from "deepagents";
import { AIMessage, createMiddleware, modelCallLimitMiddleware } from "langchain";
import { defineDeepAgent, type ManagedServerRuntime } from "managed-deepagents";
import { z } from "zod";

import { accessMiddleware, accessPolicy } from "./access.js";
import { chooseModel, createModel, MODEL_CHOICES } from "./model.js";

// Docs searches must stay in the root trace, where evaluators read them; the built-in
// general-purpose subagent would run them out of sight.
for (const provider of ["anthropic", "openai"]) {
  registerHarnessProfile(provider, { generalPurposeSubagent: { enabled: false } });
}

// Lets an eval run pick the model. Real users never set it, so they always get the default.
export const contextSchema = z.object({ eval_model: z.enum(MODEL_CHOICES).optional() });

export const CUTOFF_NOTICE =
  "_This answer reached the length limit and was cut off. Ask me to continue for the rest._";

// Anthropic reports `stop_reason: "max_tokens"`; OpenAI Chat Completions reports `finish_reason: "length"`.
function hitOutputLimit(message: AIMessage): boolean {
  return (
    message.additional_kwargs?.stop_reason === "max_tokens" ||
    message.response_metadata?.finish_reason === "length"
  );
}

/** Marks a final answer that stopped at the output budget, so it isn't shown as complete. */
export const cutoffNoticeMiddleware = createMiddleware({
  name: "cutoffNotice",
  wrapModelCall: async (request, handler) => {
    const message = await handler(request);
    if (message.tool_calls?.length || !hitOutputLimit(message)) return message;
    const content =
      typeof message.content === "string"
        ? `${message.content}\n\n${CUTOFF_NOTICE}`
        : [...message.content, { type: "text" as const, text: `\n\n${CUTOFF_NOTICE}` }];
    return new AIMessage({
      id: message.id,
      name: message.name,
      content,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
      tool_calls: message.tool_calls,
      invalid_tool_calls: message.invalid_tool_calls,
      usage_metadata: message.usage_metadata,
    });
  },
});

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
      cutoffNoticeMiddleware,
    ],
  });
}
