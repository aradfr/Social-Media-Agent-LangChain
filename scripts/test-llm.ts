/**
 * Live check of the configured model roles (costs a few tokens per run).
 *
 *   yarn test:llm
 *
 * Uses config/models.json + .env through the model provider module, exactly
 * like the graph nodes do. Exits non-zero if any check fails.
 */
import "dotenv/config";
import { z } from "zod";
import { getModel, describeRoles } from "../src/models/index.js";

type Check = { name: string; run: () => Promise<string> };

const checks: Check[] = [
  {
    name: "thinking: plain text via .text",
    run: async () => {
      const res = await getModel("thinking").invoke([
        [
          "user",
          "Write one tweet (max 200 chars) announcing a LangGraph tutorial.",
        ],
      ]);
      const text = res.text;
      if (!text || text.trim().length === 0) throw new Error("empty .text");
      if (/"type"\s*:\s*"thinking"/.test(text))
        throw new Error(".text leaked thinking content");
      return JSON.stringify(text.slice(0, 80));
    },
  },
  {
    name: "toolCalling: plain text",
    run: async () => {
      const res = await getModel("toolCalling", { temperature: 0 }).invoke([
        ["user", "Reply with just the word OK."],
      ]);
      if (!res.text.trim()) throw new Error("empty .text");
      return JSON.stringify(res.text.slice(0, 40));
    },
  },
  {
    name: "toolCalling: withStructuredOutput",
    run: async () => {
      const schema = z.object({
        reasoning: z.string(),
        relevant: z.boolean(),
      });
      const out = await getModel("toolCalling", { temperature: 0 })
        .withStructuredOutput(schema, { name: "relevancy" })
        .invoke([
          ["system", "Judge relevance for an AI developer-tools company."],
          ["user", "Blog post: Building agents with LangGraph."],
        ]);
      if (typeof out.relevant !== "boolean") throw new Error("bad shape");
      return `relevant=${out.relevant}`;
    },
  },
  {
    name: "toolCalling: bindTools with forced tool_choice",
    run: async () => {
      const model = getModel("toolCalling", { temperature: 0 });
      if (!model.bindTools) throw new Error("model has no bindTools");
      const bound = model.bindTools(
        [
          {
            name: "route",
            description: "Route the user's reply.",
            schema: z.object({
              route: z.enum([
                "rewrite_post",
                "update_date",
                "unknown_response",
              ]),
            }),
          },
        ],
        { tool_choice: "route" },
      );
      const res = await bound.invoke([
        ["user", "User replied: please post it next friday instead"],
      ]);
      const call = res.tool_calls?.[0];
      if (!call) throw new Error("no tool call returned");
      return `route=${call.args.route}`;
    },
  },
];

async function main() {
  console.log("Configured roles:");
  for (const line of describeRoles()) console.log("  " + line);
  console.log();

  let failed = 0;
  for (const c of checks) {
    const t0 = Date.now();
    try {
      const detail = await c.run();
      console.log(
        `PASS  ${c.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s) ${detail}`,
      );
    } catch (e: any) {
      failed++;
      console.log(`FAIL  ${c.name}  ${String(e?.message ?? e).slice(0, 300)}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
