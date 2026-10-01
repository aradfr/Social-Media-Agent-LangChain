/**
 * Model provider module: the only place that knows model names, providers,
 * base URLs and keys. Nodes ask for a model by ROLE:
 *
 *   const model = getModel("thinking");
 *   const model = getModel("toolCalling", { temperature: 0 });
 *
 * Roles are defined in config/models.json (see social-media-agent-model-provider
 * in the vault). With no config, LLM roles fall back to upstream behaviour.
 */
import {
  loadModelsConfig,
  resolveRole,
  type Env,
  type ModelsConfig,
  type ResolvedRole,
  type Role,
} from "./config.js";
import {
  buildFromResolved,
  type ChatModelOptions,
  type ToolCapableChatModel,
} from "./providers.js";

export * from "./config.js";
export type { ChatModelOptions, ToolCapableChatModel } from "./providers.js";

export interface BuildOptions extends ChatModelOptions {
  config?: ModelsConfig;
  env?: Env;
}

/** Build a chat model for a role (no caching; injectable for tests). */
export function buildChatModel(
  role: Role,
  opts: BuildOptions = {},
): ToolCapableChatModel {
  const resolved = resolveRole(role, { config: opts.config, env: opts.env });
  return buildFromResolved(resolved, { temperature: opts.temperature });
}

let cachedConfig: ModelsConfig | undefined;
const modelCache = new Map<string, ToolCapableChatModel>();

/**
 * Get the chat model for a role, using config/models.json + process.env.
 * Models are cached per (role, temperature).
 */
export function getModel(
  role: Role,
  opts: ChatModelOptions = {},
): ToolCapableChatModel {
  const key = `${role}|${opts.temperature ?? ""}`;
  let m = modelCache.get(key);
  if (!m) {
    cachedConfig ??= loadModelsConfig();
    m = buildChatModel(role, {
      config: cachedConfig,
      temperature: opts.temperature,
    });
    modelCache.set(key, m);
  }
  return m;
}

/** Resolved settings for a non-chat role (e.g. imageGen via @google/genai). */
export function getRoleSettings(role: Role): ResolvedRole {
  cachedConfig ??= loadModelsConfig();
  return resolveRole(role, { config: cachedConfig });
}

/** Test helper: forget cached config and models. */
export function resetModelCache(): void {
  cachedConfig = undefined;
  modelCache.clear();
}

function hostOf(r: ResolvedRole): string {
  if (r.baseUrl) {
    try {
      return new URL(r.baseUrl).host;
    } catch {
      return r.baseUrl;
    }
  }
  switch (r.provider) {
    case "anthropic":
      return "api.anthropic.com";
    case "google-vertex":
    case "google-genai":
      return "vertex";
    default:
      return "default";
  }
}

/**
 * Startup check: one line per role, e.g.
 *   "thinking: kimi-k3 @ api.moonshot.ai"
 *   "toolCalling: kimi-k2.6 @ api.moonshot.ai (thinking off)"
 * Never includes secrets. Misconfigured roles become "ERROR ..." lines.
 */
export function describeRoles(
  opts: { config?: ModelsConfig; env?: Env } = {},
): string[] {
  const config = opts.config ?? loadModelsConfig();
  const roles = Object.keys(config.roles).length
    ? Object.keys(config.roles)
    : ["thinking", "toolCalling"];
  return roles.map((role) => {
    try {
      const r = resolveRole(role, { config, env: opts.env });
      const note =
        r.thinking === "disabled"
          ? " (thinking off)"
          : r.thinking === "enabled" || r.thinking === "adaptive"
            ? ` (thinking ${r.thinking})`
            : "";
      return `${role}: ${r.model} @ ${hostOf(r)}${note}`;
    } catch (e: any) {
      return `${role}: ERROR ${e.message}`;
    }
  });
}
