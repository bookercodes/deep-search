import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  UIMessage,
  stepCountIs,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  tool,
  generateText,
  Output,
} from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages as messagesTable } from "@/lib/db/schema";
import Exa from "exa-js";

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

  getQueryHistory(): string {
    return this.getSearchHistory();
  }

  getUrlsCrawled(): string {
    return this.getCrawlHistory();
  }

  shouldStop() {
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }
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
    console.log("\nSearch results:\n" + (context.getQueryHistory() || "(none)"));
    console.log("\nCrawled content:\n" + (context.getUrlsCrawled() || "(none)"));
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

async function getNextAction(context: SystemContext): Promise<Action> {
  console.log("determining next action");
  const result = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({ schema: actionSchema }),
    system: `You are a helpful AI assistant that can search the web, crawl URLs, or answer questions. Your goal is to determine the next best action to take based on the current context.

Today's date is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

The typical workflow is:
1. Search the web to find relevant URLs
2. Crawl those URLs to get the full content
3. Answer the question using the crawled content

IMPORTANT: You must crawl URLs before answering. Search results only give you titles and URLs - you need to crawl them to get the actual content.`,
    prompt: `Message History:
${context.getMessageHistory()}

Search results (URLs found):
${context.getQueryHistory() || "(none yet)"}

Crawled content (full text from URLs):
${context.getUrlsCrawled() || "(none yet)"}

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

${context.getQueryHistory()}

${context.getUrlsCrawled()}`,
  });
}

const exa = new Exa(process.env.EXA_API_KEY);

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const USER_ID = "usr_booker";

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
      const result = streamText({
        experimental_telemetry: { isEnabled: true },
        model: openai("gpt-5"),
        providerOptions: {
          openai: {
            reasoningSummary: "auto",
            reasoningEffort: "low",
          },
        },
        system: `You are a helpful AI assistant with access to real-time web search capabilities. The current date and time is ${new Date().toLocaleString()}. When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. When users ask for up-to-date information, use the current date to provide context about how recent the information is
8. IMPORTANT: After finding relevant URLs from search results, ALWAYS use the crawlPages tool to get the full content of those pages. Never rely solely on search snippets.

Your workflow should be:
1. Use searchWeb to find 10 relevant URLs from diverse sources (news sites, blogs, official documentation, etc.)
2. Select 4-6 of the most relevant and diverse URLs to crawl
3. Use crawlPages to get the full content of those URLs
4. Use the full content to provide detailed, accurate answers

Remember to:
- Always crawl multiple sources (4-6 URLs) for each query
- Choose diverse sources (e.g., not just news sites or just blogs)
- Prioritize official sources and authoritative websites
- Use the full content to provide comprehensive answers`,
        stopWhen: stepCountIs(15),
        messages: await convertToModelMessages(messages),
        tools: {
          searchWeb: tool({
            description: "Search the web for information",
            inputSchema: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }) => {
              const result = await exa.search(query, {
                numResults: 10,
                contents: false,
              });
              return result.results;
            },
          }),
          crawlPages: tool({
            description:
              "Crawl web pages to get their full content. Pass ALL URLs you want to crawl in a single call",
            inputSchema: z.object({
              urls: z
                .array(z.string())
                .describe(
                  "Array of URLs to crawl (batch multiple URLs in one call for efficiency)",
                ),
            }),
            execute: async ({ urls }) => {
              const result = await exa.getContents(urls, {
                text: true,
              });
              return result;
            },
          }),
        },
      });
      writer.merge(result.toUIMessageStream());
    },
    onFinish: async ({ responseMessage }) => {
      await db.insert(messagesTable).values({
        id: responseMessage.id,
        userId: USER_ID,
        role: "assistant",
        parts: responseMessage.parts,
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
