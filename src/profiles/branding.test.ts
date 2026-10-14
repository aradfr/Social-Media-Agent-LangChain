import { describe, it, expect } from "@jest/globals";

/**
 * Guard: with the default profile, no prompt text the agent sends to a model
 * may contain upstream LangChain branding. Runs with AGENT_PROFILE unset
 * (default profile), as in jest's environment.
 */

const BRANDING = /langchain|community spotlight|pinwheel|lausanne/i;

describe("default profile: no LangChain branding in prompts", () => {
  it("getPrompts() sections", async () => {
    const { getPrompts } =
      await import("../agents/generate-post/prompts/index.js");
    const p = getPrompts();
    for (const [k, v] of Object.entries(p)) {
      expect([k, v]).not.toEqual([k, expect.stringMatching(BRANDING)]);
    }
  });

  it("generate-post system prompt and user prompt", async () => {
    const { GENERATE_POST_PROMPT } =
      await import("../agents/generate-post/nodes/generate-post/prompts.js");
    const { formatPrompt } =
      await import("../agents/generate-post/nodes/generate-post/utils.js");
    expect(GENERATE_POST_PROMPT).not.toMatch(BRANDING);
    expect(
      formatPrompt("report", ["https://github.com/someone/repo"]),
    ).not.toMatch(BRANDING);
  });

  it("condense prompt", async () => {
    const { CONDENSE_POST_PROMPT } =
      await import("../agents/generate-post/nodes/condense-post.js");
    expect(CONDENSE_POST_PROMPT).not.toMatch(BRANDING);
  });

  it("GitHub relevance prompt", async () => {
    const { VERIFY_RELEVANT_CONTENT_PROMPT } =
      await import("../agents/shared/nodes/verify-github.js");
    expect(VERIFY_RELEVANT_CONTENT_PROMPT).not.toMatch(BRANDING);
  });

  it("repurposer and Slack-extract prompts", async () => {
    const repurposer =
      await import("../agents/repurposer/nodes/generate-posts.js");
    expect(repurposer.POST_STRUCTURE_INSTRUCTIONS).not.toMatch(BRANDING);
    expect(repurposer.GENERATE_POST_PROMPT).not.toMatch(BRANDING);
    const { EXTRACT_CONTENT_PROMPT } =
      await import("../agents/ingest-repurposed-data/nodes/extract.js");
    expect(EXTRACT_CONTENT_PROMPT).not.toMatch(BRANDING);
  });

  it("image validation and image generation prompts", async () => {
    const { VALIDATE_IMAGES_PROMPT } =
      await import("../agents/find-and-generate-images/nodes/validate-images.js");
    expect(VALIDATE_IMAGES_PROMPT).not.toMatch(BRANDING);
    const { buildImagePrompt } =
      await import("../agents/find-and-generate-images/nodes/generate-images.js");
    expect(buildImagePrompt("report", "post", 0)).not.toMatch(BRANDING);
  });

  it("thread examples come from the profile", async () => {
    const { formatTweetExamplesForPrompt } =
      await import("../agents/generate-thread/utils.js");
    expect(formatTweetExamplesForPrompt()).not.toMatch(BRANDING);
  });
});
