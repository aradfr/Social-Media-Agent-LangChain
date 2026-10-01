/**
 * Provider adapters: turn a resolved role into a LangChain chat model,
 * enforcing the provider rules we verified against real APIs:
 *
 * 1. Forced tool_choice + thinking is rejected by Kimi (HTTP 400), so roles
 *    that do structured output / tool calls use thinking "disabled".
 * 2. ChatAnthropic only sends `thinking` when set explicitly; "default"
 *    leaves it out so the provider's own default applies.
 * 3. With thinking enabled/adaptive, temperature must be omitted.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatVertexAI } from "@langchain/google-vertexai-web";
import { CHAT_PROVIDERS, type ResolvedRole } from "./config.js";

export interface ChatModelOptions {
  /** Per-call-site temperature; dropped automatically when thinking is on. */
  temperature?: number;
}

/**
 * All adapters (ChatAnthropic, ChatOpenAI, ChatVertexAI) implement bindTools,
 * but BaseChatModel declares it optional. This type makes it required so
 * nodes can call `.bindTools(...)` without non-null assertions.
 */
export type ToolCapableChatModel = BaseChatModel & {
  bindTools: NonNullable<BaseChatModel["bindTools"]>;
};

/** Default max tokens when a thinking role doesn't set one. */
const THINKING_DEFAULT_MAX_TOKENS = 16000;

function thinkingIsOn(r: ResolvedRole): boolean {
  return r.thinking === "enabled" || r.thinking === "adaptive";
}

function anthropicThinkingParam(r: ResolvedRole, maxTokens: number) {
  switch (r.thinking) {
    case "disabled":
      return { type: "disabled" as const };
    case "enabled":
      // Budget must be below max_tokens; leave ~25% for the visible answer.
      return {
        type: "enabled" as const,
        budget_tokens: Math.max(1024, Math.floor(maxTokens * 0.75)),
      };
    case "adaptive":
      return { type: "adaptive" as const };
    default:
      return undefined; // "default": let the provider decide
  }
}

export function buildFromResolved(
  r: ResolvedRole,
  opts: ChatModelOptions = {},
): ToolCapableChatModel {
  if (!CHAT_PROVIDERS.includes(r.provider)) {
    throw new Error(
      `role "${r.role}" uses provider "${r.provider}", which is not a chat model provider`,
    );
  }
  const temperature = thinkingIsOn(r) ? undefined : opts.temperature;

  switch (r.provider) {
    case "anthropic": {
      const maxTokens =
        r.maxTokens ??
        (r.thinking === "disabled" ? undefined : THINKING_DEFAULT_MAX_TOKENS);
      const thinking = anthropicThinkingParam(
        r,
        maxTokens ?? THINKING_DEFAULT_MAX_TOKENS,
      );
      return new ChatAnthropic({
        model: r.model,
        apiKey: r.apiKey,
        ...(r.baseUrl ? { anthropicApiUrl: r.baseUrl } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(thinking ? { thinking } : {}),
      }) as ToolCapableChatModel;
    }
    case "openai-compatible":
      return new ChatOpenAI({
        model: r.model,
        // Local servers (Ollama, vLLM) ignore the key but the client needs a value.
        apiKey: r.apiKey ?? "not-needed",
        configuration: r.baseUrl ? { baseURL: r.baseUrl } : undefined,
        ...(r.maxTokens !== undefined ? { maxTokens: r.maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      }) as ToolCapableChatModel;
    case "google-vertex":
      if (!r.credentials) {
        throw new Error(`role "${r.role}" has no Google credentials`);
      }
      return new ChatVertexAI({
        model: r.model,
        authOptions: { credentials: r.credentials },
        ...(r.maxTokens !== undefined ? { maxOutputTokens: r.maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      }) as ToolCapableChatModel;
    default:
      throw new Error(`unhandled provider "${r.provider}"`);
  }
}
