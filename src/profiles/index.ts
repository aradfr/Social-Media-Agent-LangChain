/**
 * Profiles: niche / brand customisation as config.
 *
 * A profile is a folder under config/profiles/<id>/ with a profile.json and
 * optional .md/.json files it references. It holds everything that makes the
 * agent write for a specific niche, brand, or use case: business context,
 * validation rules, post structure and rules, few-shot examples, signature,
 * content exclusions, image style, curation preset.
 *
 * Select with AGENT_PROFILE=<id> (default: "default"). The legacy
 * USE_LANGCHAIN_PROMPTS=true maps to the "langchain" profile.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const DEFAULT_PROFILES_DIR = resolve(process.cwd(), "config/profiles");
export const DEFAULT_PROFILE_ID = "default";

export const FRAME_TEMPLATES = ["none", "langchain-community"] as const;
export type FrameTemplate = (typeof FRAME_TEMPLATES)[number];

export const CURATION_PRESETS = ["generic", "langchain"] as const;
export type CurationPreset = (typeof CURATION_PRESETS)[number];

export interface Profile {
  id: string;
  name: string;
  /** Brand being promoted, if any. Undefined = no brand (neutral voice). */
  brand: { name?: string; products: string[] };
  audience?: string;
  prompts: {
    businessContext: string;
    contentValidation: string;
    postStructure: string;
    postRules: string;
    examples: string[];
  };
  signature: {
    /** Prepended to every published post if set (e.g. "Acme Spotlight:"). */
    headerPrefix?: string;
    /** Phrases removed from posts before publishing. */
    stripPhrases: string[];
  };
  schedule: {
    /** IANA zone for default post times, inbox display and P1–P3 slots, e.g. Europe/Rome. */
    timezone: string;
  };
  exclusions: {
    domains: string[];
    githubOrgs: string[];
    youtubeChannels: string[];
    tweetsRequireExternalUrls: boolean;
  };
  images: {
    promptTemplate: Record<string, unknown>;
    styleVariations: string[];
    frameTemplate: FrameTemplate;
    /** Logos the image validator may keep (e.g. your own product logos). */
    allowedLogos: string[];
  };
  curation: { preset: CurationPreset };
}

type Env = Record<string, string | undefined>;

export function resolveProfileId(env: Env = process.env): string {
  const explicit = env.AGENT_PROFILE?.trim();
  if (explicit) return explicit;
  if (env.USE_LANGCHAIN_PROMPTS === "true") return "langchain";
  return DEFAULT_PROFILE_ID;
}

export function listProfiles(dir: string = DEFAULT_PROFILES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, "profile.json")))
    .sort();
}

const FILE_REF = /^[\w./-]+\.(md|txt|json)$/;

/** Inline text, or a path (relative to the profile folder) to a .md/.txt file. */
function readText(base: string, value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`profile: "${field}" must be a string`);
  }
  if (FILE_REF.test(value)) {
    const p = join(base, value);
    if (!existsSync(p)) {
      throw new Error(`profile: "${field}" references missing file ${value}`);
    }
    return readFileSync(p, "utf8").trim();
  }
  return value.trim();
}

/** Split an examples file on lines that are exactly "---". */
export function splitExamples(text: string): string[] {
  return text
    .split(/^---$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readExamples(base: string, value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return splitExamples(readText(base, value, "prompts.examples"));
}

function readJson(base: string, value: unknown, field: string) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  if (typeof value === "string" && extname(value) === ".json") {
    const p = join(base, value);
    if (!existsSync(p)) {
      throw new Error(`profile: "${field}" references missing file ${value}`);
    }
    return JSON.parse(readFileSync(p, "utf8"));
  }
  throw new Error(`profile: "${field}" must be an object or a .json file`);
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : [];

export function loadProfile(id: string, opts: { dir?: string } = {}): Profile {
  const dir = opts.dir ?? DEFAULT_PROFILES_DIR;
  const base = join(dir, id);
  const file = join(base, "profile.json");
  if (!existsSync(file) || !statSync(file).isFile()) {
    const known = listProfiles(dir);
    throw new Error(
      `profile "${id}" not found in ${dir} (available: ${known.join(", ") || "none"})`,
    );
  }
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e: any) {
    throw new Error(`profile "${id}": cannot parse profile.json: ${e.message}`);
  }
  const pr = raw.prompts ?? {};
  const img = raw.images ?? {};

  const frameTemplate = (img.frameTemplate ?? "none") as FrameTemplate;
  if (!FRAME_TEMPLATES.includes(frameTemplate)) {
    throw new Error(
      `profile "${id}": unknown images.frameTemplate "${frameTemplate}" (expected: ${FRAME_TEMPLATES.join(", ")})`,
    );
  }
  const preset = (raw.curation?.preset ?? "generic") as CurationPreset;
  if (!CURATION_PRESETS.includes(preset)) {
    throw new Error(
      `profile "${id}": unknown curation.preset "${preset}" (expected: ${CURATION_PRESETS.join(", ")})`,
    );
  }
  const timezone = String(raw.schedule?.timezone ?? "Europe/Rome");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`profile "${id}": unknown schedule.timezone "${timezone}"`);
  }
  const styleVariations = strings(img.styleVariations);
  if (!styleVariations.length) {
    throw new Error(
      `profile "${id}": images.styleVariations must not be empty`,
    );
  }

  return {
    id: raw.id ?? id,
    name: raw.name ?? id,
    brand: {
      name: raw.brand?.name || undefined,
      products: strings(raw.brand?.products),
    },
    audience: raw.audience,
    prompts: {
      businessContext: readText(
        base,
        pr.businessContext,
        "prompts.businessContext",
      ),
      contentValidation: readText(
        base,
        pr.contentValidation,
        "prompts.contentValidation",
      ),
      postStructure: readText(base, pr.postStructure, "prompts.postStructure"),
      postRules: readText(base, pr.postRules, "prompts.postRules"),
      examples: readExamples(base, pr.examples),
    },
    signature: {
      headerPrefix: raw.signature?.headerPrefix || undefined,
      stripPhrases: strings(raw.signature?.stripPhrases),
    },
    schedule: { timezone },
    exclusions: {
      domains: strings(raw.exclusions?.domains),
      githubOrgs: strings(raw.exclusions?.githubOrgs),
      youtubeChannels: strings(raw.exclusions?.youtubeChannels),
      tweetsRequireExternalUrls:
        raw.exclusions?.tweetsRequireExternalUrls === true,
    },
    images: {
      promptTemplate: readJson(
        base,
        img.promptTemplate,
        "images.promptTemplate",
      ),
      styleVariations,
      frameTemplate,
      allowedLogos: strings(img.allowedLogos),
    },
    curation: { preset },
  };
}

let cached: Profile | undefined;

/** The profile selected by AGENT_PROFILE, loaded once per process. */
export function getActiveProfile(): Profile {
  cached ??= loadProfile(resolveProfileId());
  return cached;
}

/** Test helper: forget the cached active profile. */
export function resetProfileCache(): void {
  cached = undefined;
}

/** Brand phrase for prompts, e.g. "Acme's product(s)" or "the featured product(s)". */
export function brandProducts(p: Profile = getActiveProfile()): string {
  return p.brand.name
    ? `${p.brand.name}'s product(s)`
    : "the featured product(s)";
}

/** "Acme" or "your company". */
export function brandName(p: Profile = getActiveProfile()): string {
  return p.brand.name ?? "your company";
}

/** IANA timezone used for scheduling in the active profile. */
export function scheduleTimezone(p: Profile = getActiveProfile()): string {
  return p.schedule.timezone;
}
