import type { Client } from "@langchain/langgraph-sdk";
import { useStream } from "@langchain/react";
import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Text } from "@langchain/macaw-components/Text";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { ChatConversation } from "../components/ChatConversation";
import { ChatMessage, type ChatMessageContentBlock } from "../components/ChatMessage";
import { ChatState } from "../components/ChatState";
import {
  ChatToolCall,
  ChatToolCallGroup,
  type ChatToolCallModel,
} from "../components/ChatToolCall";
import { ASSISTANT_ID, type AgentEnvironment } from "../config";
import { Composer } from "./Composer";
import { FeedbackBar, type FeedbackDeps } from "./FeedbackBar";
import { Markdown } from "./Markdown";
import { toTurns, type AssistantSegment, type MessageLike, type Turn } from "./turns";

const STARTERS = [
  "What is a LangGraph checkpointer?",
  "When should I use Deep Agents instead of plain LangGraph?",
  "I built a research agent with create_deep_agent (python). How do I (1) get its runs into LangSmith and (2) score it against a fixed set of test questions so I can compare prompt changes?",
  "how do i add memory?",
];

interface ChatViewProps {
  readonly environment: AgentEnvironment;
  readonly client: Client;
  readonly threadId: string | null;
  readonly runIds: readonly string[];
  readonly feedback: FeedbackDeps;
  /** Fires once when the agent creates the thread; `firstMessage` seeds its title. */
  readonly onThreadId: (threadId: string, firstMessage: string) => void;
  readonly onRunCreated: (runId: string) => void;
  readonly onRunFinished: () => void;
}

export function ChatView(props: ChatViewProps) {
  const { environment, client, threadId, runIds, feedback } = props;
  const [sendError, setSendError] = useState<string | null>(null);
  const lastSent = useRef("");

  const stream = useStream({
    client,
    assistantId: ASSISTANT_ID,
    // WebSockets can't carry the auth headers, so stay on SSE.
    transport: "sse",
    threadId,
    onThreadId: (id) => props.onThreadId(id, lastSent.current),
    onCreated: ({ runId }) => runId && props.onRunCreated(runId),
    onCompleted: props.onRunFinished,
  });

  const messages = stream.messages as unknown as readonly MessageLike[];
  const turns = useMemo(
    () => toTurns(messages, { streaming: stream.isLoading }),
    [messages, stream.isLoading],
  );

  const send = (text: string) => {
    setSendError(null);
    lastSent.current = text;
    stream.submit({ messages: [{ type: "human", content: text }] }).catch((cause: unknown) => {
      setSendError(cause instanceof Error ? cause.message : "Couldn't send the message.");
    });
  };

  const error = sendError ?? (stream.error ? describeError(stream.error) : null);

  return (
    <ChatConversation
      label="Conversation"
      className="h-full"
      contentClassName="mx-auto w-full max-w-3xl px-space-3 py-space-4 sm:px-space-5"
      footer={
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-2 px-space-3 pb-space-3 sm:px-space-5">
          {error ? <Banner intent="error">{error}</Banner> : null}
          <Composer busy={stream.isLoading} onSend={send} onStop={() => void stream.stop()} />
        </div>
      }
    >
      {turns.length === 0 && !stream.isLoading ? (
        <EmptyState environment={environment} onPick={send} />
      ) : (
        turns.map((turn, index) => (
          <TurnView
            key={turn.id}
            turn={turn}
            runId={runIds[index]}
            streaming={stream.isLoading && index === turns.length - 1}
            feedback={feedback}
          />
        ))
      )}
    </ChatConversation>
  );
}

function TurnView({
  turn,
  runId,
  streaming,
  feedback,
}: {
  readonly turn: Turn;
  readonly runId: string | undefined;
  readonly streaming: boolean;
  readonly feedback: FeedbackDeps;
}) {
  const blocks: ChatMessageContentBlock[] = turn.segments.map((segment) => ({
    id: segment.id,
    type: "custom",
    content: renderSegment(segment),
  }));
  if (streaming && turn.segments.length === 0) {
    blocks.push({
      id: "pending",
      type: "custom",
      content: <ChatState status="streaming" label="Searching the docs…" showElapsed />,
    });
  }

  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      {turn.userText ? (
        <ChatMessage
          align="end"
          message={{
            id: `${turn.id}:user`,
            role: "user",
            status: "completed",
            readOnly: true,
            content: [{ id: "text", type: "text", text: turn.userText, appearance: "bubble" }],
          }}
        />
      ) : null}
      {blocks.length ? (
        <ChatMessage
          isLatest={streaming}
          message={{
            id: `${turn.id}:assistant`,
            role: "assistant",
            status: streaming ? "streaming" : "completed",
            readOnly: true,
            identity: { name: "Chat LangChain Lite" },
            content: blocks,
          }}
          footer={!streaming && runId ? <FeedbackBar runId={runId} deps={feedback} /> : undefined}
        />
      ) : null}
    </div>
  );
}

function renderSegment(segment: AssistantSegment): ReactNode {
  if (segment.kind === "text") return <Markdown text={segment.text} />;
  const calls = segment.toolCalls.map((call) => <ToolCallView key={call.id} call={call} />);
  return calls.length > 1 ? (
    <ChatToolCallGroup label={`${calls.length} tool calls`}>{calls}</ChatToolCallGroup>
  ) : (
    calls
  );
}

function ToolCallView({ call }: { readonly call: ChatToolCallModel }) {
  // Deep Agents delegates to subagents through the `task` tool.
  const args = (call.args ?? {}) as { subagent_type?: string; description?: string };
  if (call.name === "task") {
    return (
      <ChatToolCall
        toolCall={call}
        label={`Subagent: ${args.subagent_type ?? "general-purpose"}`}
        summary={
          args.description ? (
            <Text variant="xs" color="tertiary">
              {args.description}
            </Text>
          ) : undefined
        }
      />
    );
  }
  return <ChatToolCall toolCall={call} label={call.name.replace(/^langchainDocs_/, "docs: ")} />;
}

function EmptyState({
  environment,
  onPick,
}: {
  readonly environment: AgentEnvironment;
  readonly onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-space-4 py-space-9 text-center">
      <Text variant="h3">Ask the LangChain docs</Text>
      <Text variant="sm" color="secondary">
        You're chatting with the {environment.label.toLowerCase()} agent.
      </Text>
      <div className="flex flex-wrap justify-center gap-space-2">
        {STARTERS.map((starter) => (
          <Button
            key={starter}
            variant="outlined"
            size="sm"
            // Button is one fixed-height line; long starters must wrap instead of overflowing.
            className="h-auto min-h-6 max-w-full whitespace-normal py-space-1"
            onClick={() => onPick(starter)}
          >
            {starter}
          </Button>
        ))}
      </div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String((error as { message: unknown }).message);
  return "Something went wrong talking to the agent.";
}
