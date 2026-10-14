import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProfile,
  listProfiles,
  resolveProfileId,
  getActiveProfile,
  resetProfileCache,
  DEFAULT_PROFILES_DIR,
} from "./index.js";

/**
 * Profiles = niche/brand customisation as config.
 * These tests use the real config/profiles directory (shipped profiles) and
 * a temp directory for loader edge cases. No network.
 */

describe("shipped profiles", () => {
  it("ships at least the 'default' and 'langchain' profiles", () => {
    const ids = listProfiles();
    expect(ids).toEqual(expect.arrayContaining(["default", "langchain"]));
  });

  it("loads the default profile with all prompt sections filled", () => {
    const p = loadProfile("default");
    expect(p.id).toBe("default");
    expect(p.prompts.businessContext.length).toBeGreaterThan(50);
    expect(p.prompts.contentValidation.length).toBeGreaterThan(50);
    expect(p.prompts.postStructure.length).toBeGreaterThan(50);
    expect(p.prompts.postRules.length).toBeGreaterThan(50);
    expect(p.prompts.examples.length).toBeGreaterThanOrEqual(3);
    expect(p.images.styleVariations.length).toBeGreaterThan(0);
    expect(typeof p.images.promptTemplate).toBe("object");
  });

  it("default profile is brand-free: no LangChain text anywhere", () => {
    const p = loadProfile("default");
    const all = JSON.stringify(p);
    expect(all).not.toMatch(/langchain/i);
    expect(all).not.toMatch(/pinwheel/i);
    expect(all).not.toMatch(/lausanne/i);
    expect(p.brand.name).toBeUndefined();
    expect(p.signature.headerPrefix).toBeUndefined();
    expect(p.images.frameTemplate).toBe("none");
    expect(p.exclusions.domains).toEqual([]);
    expect(p.curation.preset).toBe("generic");
  });

  it("langchain profile preserves upstream behaviour as one selectable option", () => {
    const p = loadProfile("langchain");
    expect(p.brand.name).toBe("LangChain");
    expect(p.signature.headerPrefix).toBe("LangChain Community Spotlight:");
    expect(p.prompts.businessContext).toMatch(/LangChain/);
    expect(p.exclusions.domains).toContain("langchain.com");
    expect(p.exclusions.githubOrgs).toContain("langchain-ai");
    expect(p.images.frameTemplate).toBe("langchain-community");
    expect(p.images.allowedLogos).toEqual(
      expect.arrayContaining(["LangChain", "LangGraph", "LangSmith"]),
    );
    expect(p.curation.preset).toBe("langchain");
  });
});

describe("resolveProfileId", () => {
  it("defaults to 'default'", () => {
    expect(resolveProfileId({})).toBe("default");
  });
  it("AGENT_PROFILE selects a profile", () => {
    expect(resolveProfileId({ AGENT_PROFILE: "my-niche" })).toBe("my-niche");
  });
  it("legacy USE_LANGCHAIN_PROMPTS=true maps to the langchain profile", () => {
    expect(resolveProfileId({ USE_LANGCHAIN_PROMPTS: "true" })).toBe(
      "langchain",
    );
  });
  it("AGENT_PROFILE wins over the legacy flag", () => {
    expect(
      resolveProfileId({ AGENT_PROFILE: "x", USE_LANGCHAIN_PROMPTS: "true" }),
    ).toBe("x");
  });
});

describe("loader edge cases (temp dir)", () => {
  let dir: string;
  const minimal = {
    id: "t",
    name: "Test",
    prompts: {
      businessContext: "business.md",
      contentValidation: "Inline validation text that is long enough.",
      postStructure: "Inline structure",
      postRules: "Inline rules",
      examples: "examples.md",
    },
    images: { promptTemplate: "image-prompt.json", styleVariations: ["s1"] },
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "profiles-"));
    mkdirSync(join(dir, "t"));
    writeFileSync(join(dir, "t", "profile.json"), JSON.stringify(minimal));
    writeFileSync(join(dir, "t", "business.md"), "Business from file\n");
    writeFileSync(
      join(dir, "t", "examples.md"),
      "First post\nline two\n---\nSecond post\n---\n\n---\nThird post\n",
    );
    writeFileSync(
      join(dir, "t", "image-prompt.json"),
      JSON.stringify({ role: "Designer" }),
    );
  });

  it("reads .md/.json references relative to the profile, keeps inline text", () => {
    const p = loadProfile("t", { dir });
    expect(p.prompts.businessContext).toBe("Business from file");
    expect(p.prompts.contentValidation).toBe(
      "Inline validation text that is long enough.",
    );
    expect(p.images.promptTemplate).toEqual({ role: "Designer" });
  });

  it("splits examples on lines that are exactly '---' and drops empty ones", () => {
    const p = loadProfile("t", { dir });
    expect(p.prompts.examples).toEqual([
      "First post\nline two",
      "Second post",
      "Third post",
    ]);
  });

  it("fills safe defaults for optional sections", () => {
    const p = loadProfile("t", { dir });
    expect(p.brand.name).toBeUndefined();
    expect(p.signature).toEqual({ headerPrefix: undefined, stripPhrases: [] });
    expect(p.exclusions).toEqual({
      domains: [],
      githubOrgs: [],
      youtubeChannels: [],
      tweetsRequireExternalUrls: false,
    });
    expect(p.images.frameTemplate).toBe("none");
    expect(p.images.allowedLogos).toEqual([]);
    expect(p.curation.preset).toBe("generic");
  });

  it("throws a clear error for an unknown profile", () => {
    expect(() => loadProfile("nope", { dir })).toThrow(/nope/);
  });

  it("throws when a referenced file is missing", () => {
    writeFileSync(
      join(dir, "t", "profile.json"),
      JSON.stringify({
        ...minimal,
        prompts: { ...minimal.prompts, postRules: "missing.md" },
      }),
    );
    expect(() => loadProfile("t", { dir })).toThrow(/missing\.md/);
  });

  it("rejects an unknown frameTemplate", () => {
    writeFileSync(
      join(dir, "t", "profile.json"),
      JSON.stringify({
        ...minimal,
        images: { ...minimal.images, frameTemplate: "fancy" },
      }),
    );
    expect(() => loadProfile("t", { dir })).toThrow(/frameTemplate/);
  });
});

describe("getActiveProfile", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetProfileCache();
  });

  it("uses AGENT_PROFILE and caches the result", () => {
    process.env.AGENT_PROFILE = "langchain";
    resetProfileCache();
    const a = getActiveProfile();
    const b = getActiveProfile();
    expect(a.id).toBe("langchain");
    expect(a).toBe(b);
  });

  it("points at config/profiles under the repo", () => {
    expect(DEFAULT_PROFILES_DIR).toMatch(/config[\\/]profiles$/);
  });
});
