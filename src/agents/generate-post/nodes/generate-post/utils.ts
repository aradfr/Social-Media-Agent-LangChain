import { filterLinksForPostContent } from "../../../utils.js";
import { getActiveProfile } from "../../../../profiles/index.js";

/**
 * Parse the LLM generation to extract the report from inside the <report> tag.
 * If the report can not be parsed, the original generation is returned.
 * @param generation The text generation to parse
 * @returns The parsed generation, or the unmodified generation if it cannot be parsed
 */
export function parseGeneration(generation: string): string {
  const reportMatch = generation.match(/<post>([\s\S]*?)<\/post>/);
  if (!reportMatch) {
    console.warn(
      "Could not parse post from generation:\nSTART OF POST GENERATION\n\n",
      generation,
      "\n\nEND OF POST GENERATION",
    );
  }
  return reportMatch ? reportMatch[1].trim() : generation;
}

export function formatPrompt(report: string, relevantLinks: string[]): string {
  const brand = getActiveProfile().brand.name;
  return `Here is the report I wrote on the content I'd like promoted${brand ? ` by ${brand}` : ""}:
<report>
${report}
</report>

Here are the relevant links used to create the report.
You should remove tracking query parameters from the link, if present.
If you are unsure whether a link's parameters are tracking, do not remove them. It's better to have a link with tracking parameters than a broken link.
Keep the whole post, including the link, within the platform limit; each link counts as 23 characters.
<links>
${filterLinksForPostContent(relevantLinks)}
</links>`;
}
