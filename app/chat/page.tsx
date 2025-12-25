import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ChatClient } from "./chat-client";
import type { UIMessage } from "ai";

const USER_ID = "usr_booker";

export default async function ChatPage() {
  const initialMessages = (await db
    .select()
    .from(messages)
    .where(eq(messages.userId, USER_ID))) as UIMessage[];

  return <ChatClient initialMessages={initialMessages} />;
}
