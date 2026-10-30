import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Input } from "@langchain/macaw-components/Input";
import { Text } from "@langchain/macaw-components/Text";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ThumbsDownIcon } from "@phosphor-icons/react/dist/ssr/ThumbsDown";
import { ThumbsUpIcon } from "@phosphor-icons/react/dist/ssr/ThumbsUp";
import { useState } from "react";

import { saveFeedback } from "./langsmith";

export interface FeedbackDeps {
  readonly fetchFn: typeof fetch;
  readonly openTrace: (runId: string) => void;
}

interface FeedbackBarProps {
  readonly runId: string;
  readonly deps: FeedbackDeps;
}

type Vote = { score: 0 | 1; feedbackId: string; comment: string };

export function FeedbackBar({ runId, deps }: FeedbackBarProps) {
  const [vote, setVote] = useState<Vote | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (score: 0 | 1, comment = vote?.comment ?? "") => {
    setError(null);
    try {
      const feedbackId = await saveFeedback(
        deps,
        { runId, score, comment: comment || undefined },
        vote?.feedbackId,
      );
      setVote({ score, feedbackId, comment });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save feedback");
    }
  };

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex items-center gap-space-1">
        <IconButton
          icon={ThumbsUpIcon}
          label="Good answer"
          size="sm"
          variant={vote?.score === 1 ? "outlined" : "plain"}
          color={vote?.score === 1 ? "primary" : "secondary"}
          onClick={() => void submit(1)}
        />
        <IconButton
          icon={ThumbsDownIcon}
          label="Bad answer"
          size="sm"
          variant={vote?.score === 0 ? "outlined" : "plain"}
          color={vote?.score === 0 ? "error" : "secondary"}
          onClick={() => void submit(0)}
        />
        <IconButton
          icon={ArrowSquareOutIcon}
          label="Open trace in LangSmith"
          size="sm"
          variant="plain"
          color="secondary"
          onClick={() => deps.openTrace(runId)}
        />
        {error ? (
          <Text variant="xs" color="error">
            {error}
          </Text>
        ) : null}
      </div>
      {vote && !vote.comment ? (
        <form
          className="flex max-w-md items-center gap-space-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) void submit(vote.score, draft.trim());
          }}
        >
          <Input
            size="sm"
            placeholder="Add a comment (optional)"
            value={draft}
            debounceMs={0}
            onChange={setDraft}
            className="flex-1"
          />
          <Button size="sm" variant="outlined" type="submit" disabled={!draft.trim()}>
            Send
          </Button>
        </form>
      ) : null}
    </div>
  );
}
