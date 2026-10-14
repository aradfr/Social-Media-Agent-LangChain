import "dotenv/config";
import { Client } from "@langchain/langgraph-sdk";
import {
  SKIP_CONTENT_RELEVANCY_CHECK,
  SKIP_USED_URLS_CHECK,
  TEXT_ONLY_MODE,
} from "../src/agents/generate-post/constants.js";
import { resolvePostLinks } from "../src/utils/post-links.js";

/**
 * Start a generate_post run on the local LangGraph server.
 *
 *   yarn generate_post <url> [<url> ...] [--text-only]
 *
 * Without arguments, links come from GENERATE_POST_LINKS in .env.
 */
async function invokeGraph() {
  const argv = process.argv.slice(2);
  const links = resolvePostLinks(argv);
  const textOnly = argv.includes("--text-only");

  const client = new Client({
    apiUrl: process.env.LANGGRAPH_API_URL || "http://localhost:54367",
  });

  const { thread_id } = await client.threads.create();
  const run = await client.runs.create(thread_id, "generate_post", {
    input: { links },
    config: {
      configurable: {
        // By default, the graph will read these values from the environment
        // [TWITTER_USER_ID]: process.env.TWITTER_USER_ID,
        // [LINKEDIN_USER_ID]: process.env.LINKEDIN_USER_ID,
        [TEXT_ONLY_MODE]: textOnly,
        // Skip relevance (business-context) check and used-URL dedupe for manual runs.
        [SKIP_CONTENT_RELEVANCY_CHECK]: true,
        [SKIP_USED_URLS_CHECK]: true,
      },
    },
  });
  console.log(
    `Started generate_post on ${links.join(", ")}\n  thread ${thread_id}\n  run    ${run.run_id}`,
  );
}

invokeGraph().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
