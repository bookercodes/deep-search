import { openai } from "@ai-sdk/openai";
import {
  UIMessage,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  Output,
} from "ai";
import { z } from "zod";
import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

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
    model: openai("gpt-4o"),
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
    model: openai("gpt-4o"),
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

export async function runAgentLoop(messages: UIMessage[]) {
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
      return answerQuestion(context);
    }

    context.incrementStep();
  }

  console.log("\n=== Loop exhausted, generating best-effort answer ===");
  return answerQuestion(context, true);
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await runAgentLoop(messages);
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
