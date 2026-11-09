// Builds an AI SDK language model from the user's key for ONE request. The key comes from a request header,
// lives only in this call's closure, and is never stored or logged (CLAUDE.md).
// Factories verified in node_modules on 2026-11-09: createAnthropic, createOpenAI, createGoogle,
// createOpenAICompatible (ai 7.0.165 provider packages), createOpenRouter (@openrouter/ai-sdk-provider 3.1).
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export const PROVIDERS = ["anthropic", "openai", "google", "openrouter", "openai_compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  /** Only for openai_compatible. */
  baseURL?: string;
}

export function languageModel(cfg: LlmConfig): LanguageModel {
  const { provider, apiKey, model } = cfg;
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "google":
      return createGoogle({ apiKey })(model);
    case "openrouter":
      return createOpenRouter({ apiKey })(model);
    case "openai_compatible":
      if (!cfg.baseURL) throw new Error("openai_compatible needs a baseURL");
      return createOpenAICompatible({ name: "byok", apiKey, baseURL: cfg.baseURL })(model);
  }
}
