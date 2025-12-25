"use client";

import { useChat } from "@ai-sdk/react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col gap-4 p-4">
      {messages.map((message) => (
        <Message key={message.id} from={message.role}>
          <MessageContent>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <span key={index}>{part.text}</span>
              ) : null,
            )}
          </MessageContent>
        </Message>
      ))}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput("");
          }
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== "ready"}
          placeholder="Say something..."
        />
        <button
          className="rounded bg-primary px-4 py-2 text-primary-foreground"
          type="submit"
          disabled={status !== "ready"}
        >
          Submit
        </button>
      </form>
    </div>
  );
}
