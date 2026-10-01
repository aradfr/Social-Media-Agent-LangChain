/**
 * Model provider config: types, loading, validation, role resolution.
 *
 * config/models.json holds non-secret settings (provider, model, base URL,
 * thinking mode, token limits) and references secrets by env var NAME.
 * Env vars LLM_<ROLE>_MODEL / LLM_<ROLE>_BASE_URL override the file.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROVIDERS = [
  "anthropic",
  "openai-compatible",
  "google-vertex",
  "google-genai",
] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Chat providers can be built into a LangChain chat model. */
export const CHAT_PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai-compatible",
  "google-vertex",
];

/**
 * default  = don't send a thinking param; the provider decides (Kimi: on).
 * disabled = send {type:"disabled"}; required for forced tool_choice.
 * enabled  = send {type:"enabled", budget_tokens}; temperature is dropped.
 * adaptive = send {type:"adaptive"}; for newer Claude models.
 */
export const THINKING_MODES = [
  "default",
  "disabled",
  "enabled",
  "adaptive",
] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

export type Role =
  "thinking" | "toolCalling" | "vision" | "imageGen" | (string & {});

export interface RoleConfig {
  provider: Provider;
  model: string;
  baseUrl?: string;
  /** Name of the env var holding the API key (never the key itself). */
  apiKeyEnv?: string;
  /** Name of the env var holding JSON credentials (Google). */
  credentialsEnv?: string;
  thinking?: ThinkingMode;
  maxTokens?: number;
}

export interface ModelsConfig {
  roles: Partial<Record<Role, RoleConfig>>;
}

export interface ResolvedRole {
  role: Role;
  provider: Provider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  credentials?: string;
  thinking: ThinkingMode;
  maxTokens?: number;
}

export type Env = Record<string, string | undefined>;

/** Upstream hardcoded model; used when a role isn't configured. */
export const UPSTREAM_DEFAULT_MODEL = "claude-sonnet-4-5";

/** Roles that fall back to upstream Anthropic defaults when unconfigured. */
const LLM_ROLES_WITH_UPSTREAM_FALLBACK = new Set<string>([
  "thinking",
  "toolCalling",
]);

export const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "config/models.json");

function validateRole(name: string, r: any): RoleConfig {
  if (!r || typeof r !== "object") {
    throw new Error(`models config: role "${name}" must be an object`);
  }
  if (!PROVIDERS.includes(r.provider)) {
    throw new Error(
      `models config: role "${name}" has unknown provider "${r.provider}" (expected one of: ${PROVIDERS.join(", ")})`,
    );
  }
  if (typeof r.model !== "string" || !r.model.trim()) {
    throw new Error(`models config: role "${name}" is missing "model"`);
  }
  if (r.thinking !== undefined && !THINKING_MODES.includes(r.thinking)) {
    throw new Error(
      `models config: role "${name}" has unknown thinking mode "${r.thinking}" (expected one of: ${THINKING_MODES.join(", ")})`,
    );
  }
  if (
    r.maxTokens !== undefined &&
    (!Number.isInteger(r.maxTokens) || r.maxTokens <= 0)
  ) {
    throw new Error(
      `models config: role "${name}" has invalid maxTokens "${r.maxTokens}"`,
    );
  }
  return r as RoleConfig;
}

/**
 * Load and validate the models config.
 * - `raw`: an already-parsed object (tests).
 * - `path`: a JSON file; a missing file yields an empty config (upstream fallback).
 */
export function loadModelsConfig(
  opts: { raw?: unknown; path?: string } = {},
): ModelsConfig {
  let raw: any = opts.raw;
  if (raw === undefined) {
    const path = opts.path ?? DEFAULT_CONFIG_PATH;
    if (!existsSync(path)) return { roles: {} };
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e: any) {
      throw new Error(`models config: cannot parse ${path}: ${e.message}`);
    }
  }
  if (!raw || typeof raw !== "object" || typeof raw.roles !== "object") {
    throw new Error(`models config: expected an object with a "roles" object`);
  }
  const roles: ModelsConfig["roles"] = {};
  for (const [name, r] of Object.entries(raw.roles)) {
    roles[name] = validateRole(name, r);
  }
  return { roles };
}

/** thinking -> THINKING, toolCalling -> TOOL_CALLING */
export function roleEnvPrefix(role: string): string {
  return "LLM_" + role.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function nonEmpty(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Resolve a role to concrete settings, applying env overrides and reading
 * secrets from the env vars the config names. Throws on a missing secret.
 */
export function resolveRole(
  role: Role,
  opts: { config?: ModelsConfig; env?: Env } = {},
): ResolvedRole {
  const env = opts.env ?? process.env;
  const config = opts.config ?? loadModelsConfig();
  const prefix = roleEnvPrefix(role);

  let rc = config.roles[role];
  if (!rc) {
    if (!LLM_ROLES_WITH_UPSTREAM_FALLBACK.has(role)) {
      throw new Error(`models config: role "${role}" is not configured`);
    }
    rc = {
      provider: "anthropic",
      model: UPSTREAM_DEFAULT_MODEL,
      apiKeyEnv: "ANTHROPIC_API_KEY",
      baseUrl: nonEmpty(env.ANTHROPIC_BASE_URL),
    };
  }

  const model = nonEmpty(env[`${prefix}_MODEL`]) ?? rc.model;
  const baseUrl = nonEmpty(env[`${prefix}_BASE_URL`]) ?? rc.baseUrl;

  const apiKeyEnv =
    rc.apiKeyEnv ??
    (rc.provider === "anthropic" ? "ANTHROPIC_API_KEY" : undefined);
  const apiKey = apiKeyEnv ? nonEmpty(env[apiKeyEnv]) : undefined;
  if (rc.provider === "anthropic" && !apiKey) {
    throw new Error(
      `models config: role "${role}" needs an API key in env var ${apiKeyEnv}, but it is empty`,
    );
  }

  let credentials: string | undefined;
  if (rc.provider === "google-vertex" || rc.provider === "google-genai") {
    const credEnv = rc.credentialsEnv ?? "GOOGLE_VERTEX_AI_WEB_CREDENTIALS";
    credentials = nonEmpty(env[credEnv]);
    if (!credentials) {
      throw new Error(
        `models config: role "${role}" needs credentials in env var ${credEnv}, but it is empty`,
      );
    }
  }

  return {
    role,
    provider: rc.provider,
    model,
    baseUrl,
    apiKey,
    apiKeyEnv,
    credentials,
    thinking: rc.thinking ?? "default",
    maxTokens: rc.maxTokens,
  };
}
