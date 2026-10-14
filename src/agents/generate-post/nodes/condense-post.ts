import { getModel } from "../../../models/index.js";
import { GeneratePostAnnotation } from "../generate-post-state.js";
import { parseGeneration } from "./generate-post/utils.js";
import { filterLinksForPostContent } from "../../utils.js";
import {
  getPlatformLimits,
  xWeightedLength,
} from "../../../platforms/index.js";
import {
  REFLECTIONS_PROMPT,
  getReflectionsPrompt,
} from "../../../utils/reflections.js";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { getPrompts } from "../prompts/index.js";
import { getActiveProfile } from "../../../profiles/index.js";

const brand = getActiveProfile().brand.name;
const PAGES = brand
  ? `${brand}'s LinkedIn and Twitter pages`
  : "the LinkedIn and Twitter pages";

export const CONDENSE_POST_PROMPT = `You're a highly skilled marketer${brand ? ` at ${brand}` : ""}, working on crafting thoughtful and engaging content for ${PAGES}.
You wrote a post for ${PAGES}, however it's a bit too long for Twitter, and thus needs to be condensed.

You wrote this marketing report on the content which you used to write the original post:
<report>
{report}
</report>

Here are the relevant links used to create the report. At least ONE should be included in the condensed post.
Each link counts as {urlLength} characters towards the post's length, no matter how long the URL is.
<links>
{links}
</links>

Do not shorten or alter the link itself. Only condense the text around it.

Here are the rules and structure you used to write the original post, which you should use when condensing the post now:
<rules-and-structure>

${getPrompts().postStructureInstructions}

<rules>
${getPrompts().postContentRules}
</rules>

{reflectionsPrompt}

</rules-and-structure>

Given the marketing report, link, rules and structure, please condense the post so its total length is at most {maxLength} characters, counting each link as {urlLength}. The original post was {originalPostLength} characters long by that count.
Ensure you keep the same structure, and do not omit any crucial content outright.

Follow this flow to rewrite the post in a condensed format:

<rewriting-flow>
1. Carefully read over the report, original post provided by the user below, the rules and structure.
2. Write down your thoughts about where and how you can condense the post inside <thinking> tags. This should contain details you think will help make the post more engaging, snippets you think can be condensed, etc. This should be the first text you write.
3. Using all the context provided to you above, the original post, and your thoughts, rewrite the post in a condensed format inside <post> tags. This should be the last text you write.
</rewriting-flow>

Follow all rules and instructions outlined above. The user message below will provide the original post. Remember to have fun while rewriting it! Go!`;

/**
 * Attempts to condense a post if the original generation is longer than 300 characters.
 * @param state The state of the graph
 * @returns A partial state of the graph
 */
export async function condensePost(
  state: typeof GeneratePostAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof GeneratePostAnnotation.State>> {
  if (!state.post) {
    throw new Error("No post found");
  }
  if (!state.report) {
    throw new Error("No report found");
  }
  if (!state.relevantLinks?.length) {
    throw new Error("No relevant links found");
  }

  const limits = getPlatformLimits("x");
  const originalPostLength = xWeightedLength(state.post || "", {
    urlLength: limits.urlLength,
  }).toString();

  const reflections = await getReflectionsPrompt(config);
  const reflectionsPrompt = REFLECTIONS_PROMPT.replace(
    "{reflections}",
    reflections,
  );

  const formattedSystemPrompt = CONDENSE_POST_PROMPT.replace(
    "{report}",
    state.report,
  )
    .replace("{links}", filterLinksForPostContent(state.relevantLinks))
    .replace("{originalPostLength}", originalPostLength)
    .replaceAll("{maxLength}", String(limits.maxLength))
    .replaceAll("{urlLength}", String(limits.urlLength))
    .replace("{reflectionsPrompt}", reflectionsPrompt);

  const condensePostModel = getModel("thinking", { temperature: 0.5 });

  const userMessageContent = `Here is the original post:\n\n${state.post}`;

  const condensePostResponse = await condensePostModel.invoke([
    {
      role: "system",
      content: formattedSystemPrompt,
    },
    {
      role: "user",
      content: userMessageContent,
    },
  ]);

  return {
    post: parseGeneration(condensePostResponse.text),
    condenseCount: state.condenseCount + 1,
  };
}
