import { ApiError, type Api } from "./api.ts";

export const QUEUE_NAME = "chat-langchain-lite-triage";
export const TRIAGE_RULE_NAME = "thumbs-down → triage";
export const THUMBS_DOWN_FILTER =
  'and(eq(is_root, true), and(eq(feedback_key, "user_score"), eq(feedback_score, 0)))';

export const QUEUE_INSTRUCTIONS = `**Triage a thumbs-down**

1. Read the question, the agent's searches, and the answer. Decide if the answer is actually wrong, incomplete, or off-tone. Set **answer_ok** to Pass or Fail and leave a note saying why.
2. If it isn't a real failure (the user was confused, or the question was unclear), stop here and click **Done**.
3. If it is a real failure, turn it into a test case:
   - Under **Assertions**, click **+ Add** two to four times. Each assertion is one thing a correct answer must (or must not) do, checkable from the answer alone. Use keys like \`must_name_checkpointer\` or \`must_not_recommend_llmchain\`. Write the comment as a full sentence ("States that…", "Does not…").
   - Assert content, not style. Tone and links have their own evaluators.
   - If this was a follow-up turn, edit **Inputs** to include the earlier messages.
   - Click **Add to Dataset & Next**.`;

export function queueBody(datasetId: string) {
  return {
    name: QUEUE_NAME,
    description: "Thumbs-down answers from the chat app, waiting for review.",
    default_dataset: datasetId,
    rubric_instructions: QUEUE_INSTRUCTIONS,
    rubric_items: [
      {
        feedback_key: "answer_ok",
        description: "Is the answer actually correct, complete and on-tone?",
        score_descriptions: { "0": "Fail: a real problem", "1": "Pass: the answer was fine" },
        is_required: true,
      },
    ],
  };
}

export function triageRuleBody(sessionId: string, queueId: string) {
  return {
    display_name: TRIAGE_RULE_NAME,
    session_id: sessionId,
    filter: THUMBS_DOWN_FILTER,
    sampling_rate: 1,
    is_enabled: true,
    add_to_annotation_queue_id: queueId,
  };
}

async function ensureFeedbackConfig(api: Api) {
  const existing = await api.get<unknown[]>("/feedback-configs", { key: "answer_ok" });
  if (existing.length > 0) return;
  try {
    await api.post("/feedback-configs", {
      feedback_key: "answer_ok",
      feedback_config: { type: "continuous", min: 0, max: 1 },
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) throw error;
  }
}

export async function findQueue(api: Api): Promise<{ id: string } | undefined> {
  const queues = await api.get<{ id: string; name: string }[]>("/annotation-queues", {
    name: QUEUE_NAME,
  });
  return queues.find((queue) => queue.name === QUEUE_NAME);
}

export async function ensureTriage(
  api: Api,
  datasetId: string,
  sessionIds: readonly string[],
): Promise<{ queueId: string; ruleIds: string[] }> {
  await ensureFeedbackConfig(api);
  const queueId =
    (await findQueue(api))?.id ??
    (await api.post<{ id: string }>("/annotation-queues", queueBody(datasetId))).id;

  const ruleIds: string[] = [];
  for (const sessionId of sessionIds) {
    const rules = await api.get<{ id: string; display_name: string }[]>("/runs/rules", {
      session_id: sessionId,
    });
    const match = rules.find((rule) => rule.display_name === TRIAGE_RULE_NAME);
    ruleIds.push(
      match?.id ??
        (await api.post<{ id: string }>("/runs/rules", triageRuleBody(sessionId, queueId))).id,
    );
  }
  return { queueId, ruleIds };
}
