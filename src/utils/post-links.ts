/**
 * Which link(s) a `generate_post` run is about. No hardcoded default:
 *   yarn generate_post <url> [<url> ...]
 * or, as a standing default, GENERATE_POST_LINKS in .env (comma/space separated).
 */
export function resolvePostLinks(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  const fromArgs = argv.filter((a) => !a.startsWith("--"));
  const raw = fromArgs.length
    ? fromArgs
    : (env.GENERATE_POST_LINKS ?? "").split(/[\s,]+/).filter(Boolean);

  if (!raw.length) {
    throw new Error(
      "No link given. Usage: yarn generate_post <url> [<url> ...]  (or set GENERATE_POST_LINKS in .env)",
    );
  }
  for (const link of raw) {
    let ok = false;
    try {
      const u = new URL(link);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`Not an http(s) URL: ${link}`);
  }
  return raw;
}
