import { describe, it, expect } from "@jest/globals";
import { resolvePostLinks } from "./post-links.js";

describe("resolvePostLinks", () => {
  it("uses links passed as CLI arguments", () => {
    expect(
      resolvePostLinks(["https://a.dev/x", "https://github.com/o/r"], {}),
    ).toEqual(["https://a.dev/x", "https://github.com/o/r"]);
  });

  it("CLI arguments win over the env default", () => {
    expect(
      resolvePostLinks(["https://a.dev/x"], {
        GENERATE_POST_LINKS: "https://b.dev",
      }),
    ).toEqual(["https://a.dev/x"]);
  });

  it("falls back to GENERATE_POST_LINKS (comma or space separated)", () => {
    expect(
      resolvePostLinks([], {
        GENERATE_POST_LINKS: "https://b.dev, https://c.dev  https://d.dev",
      }),
    ).toEqual(["https://b.dev", "https://c.dev", "https://d.dev"]);
  });

  it("ignores flags such as --text-only", () => {
    expect(resolvePostLinks(["--text-only", "https://a.dev"], {})).toEqual([
      "https://a.dev",
    ]);
  });

  it("rejects something that is not an http(s) URL", () => {
    expect(() => resolvePostLinks(["not-a-url"], {})).toThrow(/not-a-url/);
    expect(() =>
      resolvePostLinks([], { GENERATE_POST_LINKS: "ftp://x" }),
    ).toThrow(/ftp:\/\/x/);
  });

  it("throws a usage hint when no link is given anywhere", () => {
    expect(() => resolvePostLinks([], {})).toThrow(/yarn generate_post/);
  });
});
