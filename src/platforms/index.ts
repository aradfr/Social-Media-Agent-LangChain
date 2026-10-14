/**
 * Platform limits as config + X-style weighted length.
 *
 * config/platforms.json holds per-platform limits (max length, how many
 * characters a link counts as, max condense rounds). Missing file or entry =
 * built-in defaults, so behaviour is predictable without config.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PlatformLimits {
  /** Max weighted length of a post. */
  maxLength: number;
  /** Characters each URL counts as (X wraps links with t.co: 23). */
  urlLength: number;
  /** Max number of condense rounds before handing the post to the human. */
  maxCondenseRounds: number;
}

export type PlatformsConfig = Record<string, PlatformLimits>;

export const DEFAULT_PLATFORMS_PATH = resolve(
  process.cwd(),
  "config/platforms.json",
);

const BUILTIN: PlatformsConfig = {
  x: { maxLength: 280, urlLength: 23, maxCondenseRounds: 3 },
};

export function loadPlatformsConfig(
  opts: { path?: string } = {},
): PlatformsConfig {
  const path = opts.path ?? DEFAULT_PLATFORMS_PATH;
  if (!existsSync(path)) return { ...BUILTIN };
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const out: PlatformsConfig = { ...BUILTIN };
  for (const [name, v] of Object.entries<any>(raw.platforms ?? {})) {
    out[name] = { ...(BUILTIN[name] ?? BUILTIN.x), ...v };
  }
  return out;
}

let cached: PlatformsConfig | undefined;

export function getPlatformLimits(platform: string): PlatformLimits {
  cached ??= loadPlatformsConfig();
  const l = cached[platform];
  if (!l) throw new Error(`platforms config: unknown platform "${platform}"`);
  return l;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// Intl.Segmenter exists at runtime (Node >= 16) but tsconfig lib is ES2021,
// which doesn't type it. Declare the minimal shape locally.
type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};
const segmenter: GraphemeSegmenter = new (
  Intl as unknown as {
    Segmenter: new (
      locale: string | undefined,
      opts: { granularity: "grapheme" },
    ) => GraphemeSegmenter;
  }
).Segmenter(undefined, { granularity: "grapheme" });

/**
 * Weight-1 code point ranges per X's counting rules (twitter-text v3):
 * Latin, general punctuation, etc. Everything else (emoji, CJK, …) = 2.
 */
function weightOf(cp: number): number {
  if (
    (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  ) {
    return 1;
  }
  return 2;
}

/**
 * Length of `text` as X counts it: each URL = urlLength (default 23),
 * each grapheme = weight of its first code point (emoji/CJK = 2).
 */
export function xWeightedLength(
  text: string,
  opts: { urlLength?: number } = {},
): number {
  const urlLength = opts.urlLength ?? 23;
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += urlLength;
    return "";
  });
  for (const { segment } of segmenter.segment(withoutUrls)) {
    const cp = segment.codePointAt(0) ?? 0;
    // Emoji presentation sequences/ZWJ sequences: count as one emoji (2).
    total += /\p{Extended_Pictographic}/u.test(segment) ? 2 : weightOf(cp);
  }
  return total;
}

/** True if the post is still too long for the platform and rounds remain. */
export function shouldCondense(
  post: string,
  condenseCount: number,
  limits: PlatformLimits = getPlatformLimits("x"),
): boolean {
  return (
    xWeightedLength(post, { urlLength: limits.urlLength }) > limits.maxLength &&
    condenseCount < limits.maxCondenseRounds
  );
}
