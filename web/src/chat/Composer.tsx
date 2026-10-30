import { IconButton } from "@langchain/macaw-components/IconButton";
import { Textarea } from "@langchain/macaw-components/Textarea";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { StopIcon } from "@phosphor-icons/react/dist/ssr/Stop";
import { useState, type KeyboardEvent } from "react";

interface ComposerProps {
  readonly busy: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

export function Composer({ busy, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");

  const send = () => {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="flex items-end gap-space-2 rounded-lg border border-default bg-surface-level-2 p-space-2">
      <Textarea
        variant="plain"
        value={text}
        onChange={setText}
        onKeyDown={onKeyDown}
        placeholder="Ask about LangChain, LangGraph, LangSmith or Deep Agents…"
        autoResize
        maxHeight={200}
        rows={1}
        className="flex-1"
        aria-label="Message"
      />
      {busy ? (
        <IconButton icon={StopIcon} label="Stop" variant="outlined" onClick={onStop} />
      ) : (
        <IconButton
          icon={ArrowUpIcon}
          label="Send"
          color="primary"
          onClick={send}
          disabled={!text.trim()}
        />
      )}
    </div>
  );
}
