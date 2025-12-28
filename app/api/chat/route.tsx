import { messages as messagesTable } from "@/lib/db/schema";
import { openai } from "@ai-sdk/openai";
import {
  UIMessage,
  UIMessageStreamWriter,
  streamText,
  generateText,
  Output,
  createUIMessageStream,
  createUIMessageStreamResponse,
  wrapLanguageModel,
} from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { z } from "zod";

import Exa from "exa-js";
import { db } from "@/lib/db";

const exa = new Exa(process.env.EXA_API_KEY);
const USER_ID = "usr_booker";

export const maxDuration = 30;

type SearchResult = {
  id: string;
  title: string | null;
  url: string;
  score?: number;
  publishedDate?: string;
  author?: string;
};

type CrawlResult = SearchResult & {
  text: string;
};

const actionSchema = z.object({
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["search", "crawl", "answer"]).describe(
    `The type of action to take.
      - 'search': Search the web for more information.
      - 'crawl': Crawl URLs to get their full content.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  query: z
    .string()
    .nullable()
    .describe(
      "The query to search for. Required if type is 'search', null otherwise.",
    ),
  urls: z
    .array(z.string())
    .nullable()
    .describe(
      "The URLs to crawl. Required if type is 'crawl', null otherwise.",
    ),
});

type Action = z.infer<typeof actionSchema>;

const queryRewriterSchema = z.object({
  plan: z
    .string()
    .describe("A detailed plan of how to approach answering the question."),
  queries: z
    .array(z.string())
    .describe("A list of search queries to execute in parallel."),
});

export async function rewriteQuery(initialQuery: string) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const result = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({ schema: queryRewriterSchema }),
    system: `Today's date is ${today}.

You are a strategic research planner with expertise in breaking down complex questions into logical search steps. Your primary role is to create a detailed research plan before generating any search queries.

First, analyze the question thoroughly:

- Break down the core components and key concepts
- Identify any implicit assumptions or context needed
- Consider what foundational knowledge might be required
- Think about potential information gaps that need filling

Then, develop a strategic research plan that:

- Outlines the logical progression of information needed
- Identifies dependencies between different pieces of information
- Considers multiple angles or perspectives that might be relevant
- Anticipates potential dead-ends or areas needing clarification

Finally, translate this plan into a numbered list of 3-5 sequential search queries that:

- Are specific and focused (avoid broad queries that return general information)
- Are written in natural language without Boolean operators (no AND/OR)
- Progress logically from foundational to specific information
- Build upon each other in a meaningful way

Remember that initial queries can be exploratory - they help establish baseline information or verify assumptions before proceeding to more targeted searches. Each query should serve a specific purpose in your overall research plan.`,
    prompt: initialQuery,
  });

  return result.output!;
}

class SystemContext {
  private step = 0;
  private readonly messages: UIMessage[];
  private searchHistory: SearchResult[] = [];
  private crawlHistory: CrawlResult[] = [];

  constructor(messages: UIMessage[]) {
    this.messages = messages;
  }

  addSearchResults(results: SearchResult[]) {
    this.searchHistory.push(...results);
  }

  addCrawls(crawls: CrawlResult[]) {
    this.crawlHistory.push(...crawls);
  }

  getSearchHistory(): string {
    return this.searchHistory.map((r) => `- ${r.title}: ${r.url}`).join("\n");
  }

  getCrawlHistory(): string {
    return this.crawlHistory
      .map((r) => `## ${r.title}\n${r.url}\n\n${r.text}`)
      .join("\n\n---\n\n");
  }

  getMessageHistory(): string {
    return this.messages
      .map(
        (m) =>
          `${m.role}: ${m.parts.map((p) => (p as any).text ?? "").join("")}`,
      )
      .join("\n");
  }

  shouldStop() {
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }
}

async function getNextAction(context: SystemContext): Promise<Action> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const result = await generateText({
    model: wrapLanguageModel({
      model: openai("gpt-4o"),
      middleware: devToolsMiddleware(),
    }),
    output: Output.object({ schema: actionSchema }),
    system: `You are a helpful AI assistant that can search the web, crawl URLs, or answer questions. Your goal is to determine the next best action to take based on the current context.

Today's date is ${today}.

The typical workflow is:
1. Search the web to find relevant URLs
2. Crawl those URLs to get the full content
3. Answer the question using the crawled content

IMPORTANT: You must crawl URLs before answering. Search results only give you titles and URLs - you need to crawl them to get the actual content.`,
    prompt: `Message History:
${context.getMessageHistory()}

Search results (URLs found):
${context.getSearchHistory() || "(none yet)"}

Crawled content (full text from URLs):
${context.getCrawlHistory() || "(none yet)"}

Based on this context, choose the next action:

1. If you haven't searched yet, use 'search' with a relevant query
2. If you have search results but haven't crawled them, use 'crawl' with URLs from the search results
3. If you have crawled content, use 'answer' to respond to the user

IMPORTANT: Do not use 'answer' until you have crawled at least some URLs. Search results alone are not enough.
`,
  });

  return result.output!;
}

function answerQuestion(context: SystemContext, exhausted: boolean = false) {
  return streamText({
    model: wrapLanguageModel({
      model: openai("gpt-4o"),
      middleware: devToolsMiddleware(),
    }),
    system: `You are a helpful AI assistant that answers questions based on the information gathered from web searches and crawled content.

When answering:

1. Be thorough but concise
2. Always cite your sources using markdown links
3. If you're unsure about something, say so
4. Format URLs as markdown links using [title](url)
5. Never include raw URLs

${exhausted ? "Note: We may not have all the information needed to answer the question completely. Please provide your best attempt at an answer based on the available information." : ""}`,
    prompt: `Message History:
${context.getMessageHistory()}

Based on the following context, please answer the question:

${context.getSearchHistory()}

${context.getCrawlHistory()}`,
  });
}

export async function runAgentLoop(
  messages: UIMessage[],
  writer: UIMessageStreamWriter,
) {
  console.log("\n=== runAgentLoop started ===");
  console.log(`Processing ${messages.length} message(s)`);

  const context = new SystemContext(messages);
  let step = 0;

  while (!context.shouldStop()) {
    step++;
    console.log(`\n--- Step ${step} ---`);
    console.log("\nCurrent context:");
    console.log("Messages:\n" + context.getMessageHistory());
    console.log(
      "\nSearch results:\n" + (context.getSearchHistory() || "(none)"),
    );
    console.log(
      "\nCrawled content:\n" + (context.getCrawlHistory() || "(none)"),
    );
    console.log("\nDetermining next action...");

    const nextAction = await getNextAction(context);
    console.log(`Action: ${nextAction.type}`);
    console.log(`Reasoning: ${nextAction.reasoning}`);

    // Emit reasoning events
    const reasoningId = `reasoning-${step}`;
    console.log(`[STREAM] Writing reasoning-start for ${reasoningId}`);
    writer.write({ type: "reasoning-start", id: reasoningId });
    console.log(`[STREAM] Writing reasoning-delta for ${reasoningId}`);
    writer.write({
      type: "reasoning-delta",
      id: reasoningId,
      delta: nextAction.reasoning,
    });
    console.log(`[STREAM] Writing reasoning-end for ${reasoningId}`);
    writer.write({ type: "reasoning-end", id: reasoningId });

    if (nextAction.type === "search") {
      console.log(`Searching for: "${nextAction.query}"`);
      const result = await exa.search(nextAction.query!, {
        numResults: 10,
      });
      console.log(`Found ${result.results.length} results`);
      context.addSearchResults(result.results);
    }

    if (nextAction.type === "crawl") {
      console.log(`Crawling ${nextAction.urls!.length} URL(s):`);
      nextAction.urls!.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
      const result = await exa.getContents(nextAction.urls!, {
        text: true,
      });
      console.log(`Crawled ${result.results.length} page(s)`);
      context.addCrawls(result.results);
    }

    if (nextAction.type === "answer") {
      console.log("\n=== Generating answer ===");
      const result = answerQuestion(context);
      writer.merge(result.toUIMessageStream());
      return;
    }

    context.incrementStep();
  }

  console.log("\n=== Loop exhausted, generating best-effort answer ===");
  const result = answerQuestion(context, true);
  writer.merge(result.toUIMessageStream());
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  // Save the latest user message
  const lastMessage = messages[messages.length - 1];
  await db.insert(messagesTable).values({
    id: lastMessage.id,
    userId: USER_ID,
    role: "user",
    parts: lastMessage.parts,
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await runAgentLoop(messages, writer);
    },
  });

  return createUIMessageStreamResponse({ stream });
}

