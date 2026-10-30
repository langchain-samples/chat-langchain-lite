import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import {
  chooseModel,
  createModel,
  DEFAULT_MODEL,
  GATEWAY_ANTHROPIC_URL,
  GATEWAY_OPENAI_URL,
  gatewayApiKey,
  gptLunaOptions,
  modelOptions,
} from "../model.js";

describe("gatewayApiKey", () => {
  it("returns the gateway key", () => {
    expect(gatewayApiKey({ LANGSMITH_GATEWAY_API_KEY: "g" })).toBe("g");
  });

  it("rejects a missing or blank key instead of falling back to the LangSmith key", () => {
    expect(() => gatewayApiKey({ LANGSMITH_API_KEY: "l" })).toThrow(/LANGSMITH_GATEWAY_API_KEY/);
    expect(() =>
      gatewayApiKey({ LANGSMITH_GATEWAY_API_KEY: "", LANGSMITH_API_KEY: "l" }),
    ).toThrow();
  });
});

describe("modelOptions", () => {
  const options = modelOptions({ LANGSMITH_GATEWAY_API_KEY: "g" });

  it("routes Haiku 5.5 through the LangChain Inc Gateway", () => {
    expect(options.model).toBe("claude-haiku-5-5");
    expect(options.anthropicApiUrl).toBe(GATEWAY_ANTHROPIC_URL);
  });

  it("disables extended thinking", () => {
    expect(options.thinking).toEqual({ type: "disabled" });
  });
});

describe("chooseModel", () => {
  it("accepts allowlisted models and falls back to Haiku for anything else", () => {
    expect(chooseModel("gpt-6-luna")).toBe("gpt-6-luna");
    expect(chooseModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(chooseModel("gpt-4o")).toBe(DEFAULT_MODEL);
    expect(chooseModel(undefined)).toBe(DEFAULT_MODEL);
  });
});

describe("gptLunaOptions", () => {
  const options = gptLunaOptions({ LANGSMITH_GATEWAY_API_KEY: "g" });

  it("routes gpt-6-luna through the Gateway's Chat Completions route", () => {
    expect(options.configuration.baseURL).toBe(GATEWAY_OPENAI_URL);
    expect(options.useResponsesApi).toBe(false);
  });

  it("matches the Anthropic model's output budget with reasoning off", () => {
    expect(options.maxTokens).toBe(modelOptions({ LANGSMITH_GATEWAY_API_KEY: "g" }).maxTokens);
    expect(options.reasoning).toEqual({ effort: "none" });
  });
});

describe("createModel", () => {
  const env = { LANGSMITH_GATEWAY_API_KEY: "g" };

  it("builds the chosen provider's chat model", () => {
    expect(createModel(env)).toBeInstanceOf(ChatAnthropic);
    expect(createModel(env, "gpt-6-luna")).toBeInstanceOf(ChatOpenAI);
  });
});
