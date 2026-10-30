import type { ChatToolCallModel } from "../components/ChatToolCall";

/** The fields we read from LangChain messages; live and reloaded threads both satisfy it. */
export interface MessageLike {
  readonly id?: string;
  readonly type: string;
  readonly content: unknown;
  readonly tool_calls?: ReadonlyArray<{
    readonly id?: string;
    readonly name: string;
    readonly args?: unknown;
  }>;
  readonly tool_call_id?: string;
  readonly status?: string;
}

export type AssistantSegment =
  | { readonly kind: "text"; readonly id: string; readonly text: string }
  | {
      readonly kind: "tools";
      readonly id: string;
      readonly toolCalls: readonly ChatToolCallModel[];
    };

export interface Turn {
  readonly id: string;
  readonly userText: string;
  readonly segments: readonly AssistantSegment[];
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && block.type === "text" ? String(block.text ?? "") : "",
    )
    .join("");
}

/**
 * Groups messages into turns that each start at a human message. Tool calls are paired with
 * their tool messages, so a turn renders the same whether it streamed live or came from history.
 */
export function toTurns(
  messages: readonly MessageLike[],
  options: { readonly streaming: boolean },
): Turn[] {
  const results = new Map(
    messages
      .filter((m) => m.type === "tool" && m.tool_call_id)
      .map((m) => [m.tool_call_id!, m] as const),
  );
  const turns: Array<{ id: string; userText: string; segments: AssistantSegment[] }> = [];

  messages.forEach((message, index) => {
    if (message.type === "human") {
      turns.push({
        id: message.id ?? `turn-${index}`,
        userText: textOf(message.content),
        segments: [],
      });
      return;
    }
    if (message.type !== "ai") return;
    // An assistant message before any human message still needs a turn to live in.
    if (turns.length === 0) turns.push({ id: `turn-${index}`, userText: "", segments: [] });
    const turn = turns[turns.length - 1]!;
    const isLastTurn = !messages.slice(index + 1).some((m) => m.type === "human");
    const id = message.id ?? `ai-${index}`;

    const text = textOf(message.content);
    if (text.trim()) turn.segments.push({ kind: "text", id: `${id}:text`, text });

    const toolCalls = (message.tool_calls ?? []).map((call, callIndex): ChatToolCallModel => {
      const callId = call.id ?? `${id}:call-${callIndex}`;
      const result = call.id ? results.get(call.id) : undefined;
      return {
        id: callId,
        name: call.name,
        args: call.args,
        ...toolStatus(result, options.streaming && isLastTurn),
      };
    });
    if (toolCalls.length) turn.segments.push({ kind: "tools", id: `${id}:tools`, toolCalls });
  });

  return turns;
}

function toolStatus(
  result: MessageLike | undefined,
  inFlight: boolean,
): Pick<ChatToolCallModel, "status" | "result" | "error"> {
  if (!result) return { status: inFlight ? "running" : "canceled" };
  const output = textOf(result.content);
  return result.status === "error"
    ? { status: "failed", error: output }
    : { status: "succeeded", result: output };
}
