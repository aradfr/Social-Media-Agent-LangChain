import { getActiveProfile } from "../../../profiles/index.js";

/**
 * Prompt sections used across the agent. Content comes from the active
 * profile (config/profiles/<AGENT_PROFILE>/). Edit those files, not this one.
 *
 * Kept as a thin adapter so existing call sites (`getPrompts().businessContext`,
 * …) keep working unchanged.
 */
export function getPrompts() {
  const p = getActiveProfile();
  return {
    businessContext: p.prompts.businessContext,
    tweetExamples: formatExamples(p.prompts.examples),
    postStructureInstructions: p.prompts.postStructure,
    postContentRules: p.prompts.postRules,
    contentValidationPrompt: p.prompts.contentValidation,
  };
}

export function formatExamples(examples: string[]): string {
  return examples
    .map(
      (example, index) => `<example index="${index}">\n${example}\n</example>`,
    )
    .join("\n");
}
