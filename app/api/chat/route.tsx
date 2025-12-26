import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  UIMessage,
  stepCountIs,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  tool,
} from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages as messagesTable } from "@/lib/db/schema";
import Exa from "exa-js";

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
