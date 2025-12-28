import "dotenv/config";
import { rewriteQuery } from "./app/api/chat/route";

async function main() {
  const query = "best commuter bike for Londoners 2025?";

  console.log("Original query:", query);
  console.log("\nGenerating search queries...\n");

  const result = await rewriteQuery(query);

  console.log("Plan:");
  console.log(result.plan);
  console.log("\nGenerated queries:");
  result.queries.forEach((q, i) => console.log(`${i + 1}. ${q}`));

  console.log("\nDone!");
}

main().catch(console.error);
