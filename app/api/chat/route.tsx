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
        model: openai("gpt-5"),
        providerOptions: {
          openai: {
            reasoningSummary: "auto",
            reasoningEffort: "low",
          },
        },
        system: `You are a helpful AI assistant with access to real-time web search capabilities. When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format

Remember to use the searchWeb tool whenever you need to find current information.`,
        stopWhen: stepCountIs(5),
        messages: await convertToModelMessages(messages),
        tools: {
          searchWeb: openai.tools.webSearch({
            userLocation: {
              city: "London",
              country: "GB",
              type: "approximate",
            },
          }),
          calculate: tool({
            description: "",
            inputSchema: z.object({
              expression: z.string(),
            }),
            execute: ({ expression }) => {
              const result = Function(`"use strict"; return (${expression})`)();
              return { expression, result };
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
