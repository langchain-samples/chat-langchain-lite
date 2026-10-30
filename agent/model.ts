import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

type Env = Record<string, string | undefined>;

export const GATEWAY_ANTHROPIC_URL = "https://gateway.smith.langchain.com/anthropic";
export const GATEWAY_OPENAI_URL = "https://gateway.smith.langchain.com/openai/v1";

export const MODEL_CHOICES = ["claude-haiku-5-5", "gpt-6-luna"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];
export const DEFAULT_MODEL: ModelChoice = "claude-haiku-5-5";

const MAX_OUTPUT_TOKENS = 900;

export function chooseModel(value: unknown): ModelChoice {
  return MODEL_CHOICES.find((choice) => choice === value) ?? DEFAULT_MODEL;
}

// Deploy fills a blank LANGSMITH_GATEWAY_API_KEY from the deploy key, which can't call the Gateway,
// so require a real key instead of falling back.
export function gatewayApiKey(env: Env): string {
  const key = env.LANGSMITH_GATEWAY_API_KEY;
  if (!key) {
    throw new Error(
      "LANGSMITH_GATEWAY_API_KEY is not set. Run `mise run setup` or add it to agent/.env.",
    );
  }
  return key;
}

export function modelOptions(env: Env) {
  return {
    model: "claude-haiku-5-5",
    anthropicApiUrl: GATEWAY_ANTHROPIC_URL,
    apiKey: gatewayApiKey(env),
    maxTokens: MAX_OUTPUT_TOKENS,
    thinking: { type: "disabled" as const },
  };
}

export function gptLunaOptions(env: Env) {
  return {
    model: "gpt-6-luna",
    apiKey: gatewayApiKey(env),
    configuration: { baseURL: GATEWAY_OPENAI_URL },
    // The Gateway route speaks Chat Completions, not the Responses API.
    useResponsesApi: false,
    maxTokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: "none" as const },
  };
}

export function createModel(
  env: Env,
  choice: ModelChoice = DEFAULT_MODEL,
): ChatAnthropic | ChatOpenAI {
  return choice === "gpt-6-luna"
    ? new ChatOpenAI(gptLunaOptions(env))
    : new ChatAnthropic(modelOptions(env));
}
