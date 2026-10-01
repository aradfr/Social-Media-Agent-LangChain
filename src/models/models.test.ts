import { describe, it, expect } from "@jest/globals";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import {
  loadModelsConfig,
  resolveRole,
  buildChatModel,
  describeRoles,
  UPSTREAM_DEFAULT_MODEL,
  type ModelsConfig,
} from "./index.js";

/**
 * Unit tests for the model provider module.
 * No network: config and env are injected, models are only constructed.
 */

const KEY = "sk-test-not-real";

const baseConfig: ModelsConfig = {
  roles: {
    thinking: {
      provider: "anthropic",
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.ai/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      thinking: "default",
      maxTokens: 16000,
    },
    toolCalling: {
      provider: "anthropic",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.ai/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      thinking: "disabled",
      maxTokens: 4096,
    },
    vision: {
      provider: "google-vertex",
      model: "gemini-2.5-pro",
      credentialsEnv: "GOOGLE_VERTEX_AI_WEB_CREDENTIALS",
    },
  },
};

const env = { ANTHROPIC_API_KEY: KEY };

describe("loadModelsConfig", () => {
  it("parses a valid config object", () => {
    const cfg = loadModelsConfig({ raw: baseConfig });
    expect(cfg.roles.thinking?.model).toBe("kimi-k3");
  });

  it("returns an empty config when no file exists (upstream fallback)", () => {
    const cfg = loadModelsConfig({ path: "/nonexistent/models.json" });
    expect(cfg.roles).toEqual({});
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      loadModelsConfig({
        raw: { roles: { thinking: { provider: "bogus", model: "x" } } },
      }),
    ).toThrow(/provider/i);
  });

  it("rejects an unknown thinking mode", () => {
    expect(() =>
      loadModelsConfig({
        raw: {
          roles: {
            thinking: { provider: "anthropic", model: "x", thinking: "maybe" },
          },
        },
      }),
    ).toThrow(/thinking/i);
  });

  it("rejects a role without a model", () => {
    expect(() =>
      loadModelsConfig({
        raw: { roles: { thinking: { provider: "anthropic" } } },
      }),
    ).toThrow(/model/i);
  });
});

describe("resolveRole", () => {
  it("returns the configured role with the api key read from the named env var", () => {
    const r = resolveRole("thinking", { config: baseConfig, env });
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("kimi-k3");
    expect(r.baseUrl).toBe("https://api.moonshot.ai/anthropic");
    expect(r.apiKey).toBe(KEY);
    expect(r.thinking).toBe("default");
  });

  it("env overrides beat the file (LLM_<ROLE>_MODEL / _BASE_URL)", () => {
    const r = resolveRole("thinking", {
      config: baseConfig,
      env: {
        ...env,
        LLM_THINKING_MODEL: "claude-opus-x",
        LLM_THINKING_BASE_URL: "https://api.anthropic.com",
      },
    });
    expect(r.model).toBe("claude-opus-x");
    expect(r.baseUrl).toBe("https://api.anthropic.com");
  });

  it("maps camelCase roles to SNAKE_CASE env overrides", () => {
    const r = resolveRole("toolCalling", {
      config: baseConfig,
      env: { ...env, LLM_TOOL_CALLING_MODEL: "qwen3:8b" },
    });
    expect(r.model).toBe("qwen3:8b");
  });

  it("falls back to upstream Anthropic defaults for an unconfigured LLM role", () => {
    const r = resolveRole("thinking", {
      config: { roles: {} },
      env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://x.test" },
    });
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe(UPSTREAM_DEFAULT_MODEL);
    expect(r.apiKey).toBe(KEY);
    expect(r.baseUrl).toBe("https://x.test");
  });

  it("throws a clear error when the referenced api key env var is empty", () => {
    expect(() =>
      resolveRole("thinking", { config: baseConfig, env: {} }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("does not require an api key for openai-compatible local servers", () => {
    const r = resolveRole("toolCalling", {
      config: {
        roles: {
          toolCalling: {
            provider: "openai-compatible",
            model: "qwen3:8b",
            baseUrl: "http://localhost:11434/v1",
          },
        },
      },
      env: {},
    });
    expect(r.apiKey).toBeUndefined();
  });
});

describe("buildChatModel", () => {
  it("builds ChatAnthropic for the anthropic provider with model and base url", () => {
    const m = buildChatModel("toolCalling", { config: baseConfig, env });
    expect(m).toBeInstanceOf(ChatAnthropic);
    const a = m as ChatAnthropic;
    expect(a.model).toBe("kimi-k2.6");
    expect(a.apiUrl).toBe("https://api.moonshot.ai/anthropic");
  });

  it("toolCalling-style role sends thinking disabled explicitly and keeps temperature", () => {
    const m = buildChatModel("toolCalling", {
      config: baseConfig,
      env,
      temperature: 0,
    }) as ChatAnthropic;
    const params = m.invocationParams({});
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.temperature).toBe(0);
  });

  it("thinking 'default' omits the thinking param (provider decides) and keeps temperature", () => {
    const m = buildChatModel("thinking", {
      config: baseConfig,
      env,
      temperature: 0,
    }) as ChatAnthropic;
    const params = m.invocationParams({});
    expect(params.thinking).toBeUndefined();
    expect(params.max_tokens).toBe(16000);
  });

  it("thinking 'enabled' sends a budget and DROPS temperature (Anthropic rule)", () => {
    const cfg: ModelsConfig = {
      roles: {
        thinking: {
          provider: "anthropic",
          model: "claude-opus-x",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          thinking: "enabled",
          maxTokens: 16000,
        },
      },
    };
    const m = buildChatModel("thinking", {
      config: cfg,
      env,
      temperature: 0,
    }) as ChatAnthropic;
    const params = m.invocationParams({});
    expect(params.thinking?.type).toBe("enabled");
    expect((params.thinking as any).budget_tokens).toBeGreaterThan(0);
    expect((params.thinking as any).budget_tokens).toBeLessThan(16000);
    expect(params.temperature).toBeUndefined();
  });

  it("builds ChatOpenAI for openai-compatible (local Ollama) with the base url", () => {
    const m = buildChatModel("toolCalling", {
      config: {
        roles: {
          toolCalling: {
            provider: "openai-compatible",
            model: "qwen3:8b",
            baseUrl: "http://localhost:11434/v1",
          },
        },
      },
      env: {},
      temperature: 0,
    });
    expect(m).toBeInstanceOf(ChatOpenAI);
    const o = m as ChatOpenAI;
    expect(o.model).toBe("qwen3:8b");
    expect(o.clientConfig?.baseURL).toBe("http://localhost:11434/v1");
  });

  it("refuses to build a chat model for a non-chat provider role", () => {
    expect(() =>
      buildChatModel("imageGen", {
        config: {
          roles: {
            imageGen: {
              provider: "google-genai",
              model: "gemini-3-pro-image",
              credentialsEnv: "GOOGLE_VERTEX_AI_WEB_CREDENTIALS",
            },
          },
        },
        env: { GOOGLE_VERTEX_AI_WEB_CREDENTIALS: "{}" },
      }),
    ).toThrow(/google-genai/);
  });
});

describe("describeRoles (startup check)", () => {
  it("prints one line per role with model and host, never the key", () => {
    const lines = describeRoles({ config: baseConfig, env });
    const joined = lines.join("\n");
    expect(joined).toContain("thinking: kimi-k3 @ api.moonshot.ai");
    expect(joined).toContain(
      "toolCalling: kimi-k2.6 @ api.moonshot.ai (thinking off)",
    );
    expect(joined).not.toContain(KEY);
  });

  it("marks a role with a missing key as an error instead of throwing", () => {
    const lines = describeRoles({ config: baseConfig, env: {} });
    expect(lines.join("\n")).toMatch(/thinking: ERROR .*ANTHROPIC_API_KEY/);
  });
});
