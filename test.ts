import "dotenv/config";
import { runAgentLoop } from "./app/api/chat/route";

async function main() {
  const messages = [
    {
      id: "1",
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: "what is the best electric commuter bike for Londoners?",
        },
      ],
    },
  ];

  console.log("runAgentLoop() called");
  const result = await runAgentLoop(messages);

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  console.log("\n\nDone!");
}

main().catch(console.error);
