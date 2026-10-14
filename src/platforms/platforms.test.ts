import { describe, it, expect } from "@jest/globals";
import {
  xWeightedLength,
  getPlatformLimits,
  shouldCondense,
  loadPlatformsConfig,
} from "./index.js";

/**
 * X (Twitter) counts characters with weights: every URL = 23, most Latin
 * text = 1 per character, emoji and CJK = 2. Upstream removed URLs before
 * counting, so posts with a link came out ~20-60 chars over the limit.
 */

describe("xWeightedLength", () => {
  it("counts plain ASCII 1 per character", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("a b\nc")).toBe(5);
  });

  it("counts any http(s) URL as 23 regardless of its length", () => {
    expect(xWeightedLength("https://x.co")).toBe(23);
    expect(
      xWeightedLength(
        "https://github.com/rguthaa/genai-usecases/tree/main?utm_source=very-long-tracking-parameter",
      ),
    ).toBe(23);
  });

  it("adds text and URLs together", () => {
    const text = "a".repeat(250) + " https://github.com/x/y";
    expect(xWeightedLength(text)).toBe(250 + 1 + 23);
    expect(xWeightedLength("see https://a.io and https://b.io")).toBe(
      4 + 23 + 5 + 23,
    );
  });

  it("counts emoji as 2, including ZWJ sequences", () => {
    expect(xWeightedLength("🚀")).toBe(2);
    expect(xWeightedLength("👩‍💻")).toBe(2);
    expect(xWeightedLength("Hi 🔦")).toBe(5);
  });

  it("counts CJK as 2 and accented Latin as 1", () => {
    expect(xWeightedLength("日本")).toBe(4);
    expect(xWeightedLength("é")).toBe(1);
  });

  it("uses a custom urlLength when given", () => {
    expect(xWeightedLength("https://a.io", { urlLength: 10 })).toBe(10);
  });
});

describe("platform limits config", () => {
  it("ships X limits in config/platforms.json", () => {
    const x = getPlatformLimits("x");
    expect(x.maxLength).toBe(280);
    expect(x.urlLength).toBe(23);
    expect(x.maxCondenseRounds).toBeGreaterThan(0);
  });

  it("falls back to built-in X defaults when the file is missing", () => {
    const cfg = loadPlatformsConfig({ path: "/nonexistent/platforms.json" });
    expect(cfg.x).toEqual({
      maxLength: 280,
      urlLength: 23,
      maxCondenseRounds: 3,
    });
  });
});

describe("shouldCondense (length gate before review)", () => {
  const limits = { maxLength: 280, urlLength: 23, maxCondenseRounds: 3 };
  const url = " https://github.com/rguthaa/genai-usecases/tree/main";

  it("condenses when text + link exceed the limit (upstream missed this)", () => {
    // 260 visible chars: upstream counted 260 <= 280 and skipped condensing,
    // but X counts 260 + 1 + 23 = 284.
    expect(shouldCondense("a".repeat(260) + url, 0, limits)).toBe(true);
  });

  it("does not condense when the post fits including the link", () => {
    expect(shouldCondense("a".repeat(250) + url, 0, limits)).toBe(false);
  });

  it("stops after maxCondenseRounds rounds", () => {
    const long = "a".repeat(400);
    expect(shouldCondense(long, 2, limits)).toBe(true);
    expect(shouldCondense(long, 3, limits)).toBe(false);
  });
});
