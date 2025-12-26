"use client";

import { useChat } from "@ai-sdk/react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { DefaultChatTransport, isStaticToolUIPart, getToolName } from "ai";
import type { UIMessage, UIMessagePart, ToolUIPart } from "ai";

interface ChatClientProps {
  initialMessages: UIMessage[];
}

function renderPart(
  part: UIMessagePart | ToolUIPart,
  index: number,
  isStreaming: boolean,
) {
  if (isStaticToolUIPart(part)) {
    return (
      <Tool key={index}>
        <ToolHeader
          title={getToolName(part)}
          type={part.type}
          state={part.state}
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={part.output} errorText={part.errorText} />
        </ToolContent>
      </Tool>
    );
  }

  switch (part.type) {
    case "text":
      return <MessageResponse key={index}>{part.text}</MessageResponse>;
    case "reasoning":
      return (
        <Reasoning
          key={index}
          isStreaming={isStreaming}
          defaultOpen={isStreaming}
        >
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    default:
      console.log("Unknown part type:", part);
      return null;
  }
}

export function ChatClient({ initialMessages }: ChatClientProps) {
  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <div className="flex h-screen flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message, messageIndex) => {
            const isLastMessage = messageIndex === messages.length - 1;
            const isStreaming = isLastMessage && status === "streaming";

            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, index) =>
                    renderPart(part, index, isStreaming),
                  )}
                </MessageContent>
              </Message>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <PromptInput
          onSubmit={(message) => {
            if (message.text.trim()) {
              sendMessage({ text: message.text, files: message.files });
            }
          }}
        >
          <PromptInputTextarea
            placeholder="Ask anything..."
            disabled={status !== "ready"}
          />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status={status} disabled={status !== "ready"} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
