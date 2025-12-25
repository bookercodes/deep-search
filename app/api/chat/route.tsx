import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  UIMessage,
  stepCountIs,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log("messages", messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model: openai("gpt-5.2-chat-latest"),
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
        },
      });
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
