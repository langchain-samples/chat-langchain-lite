import type { Api } from "./api.ts";

// Resolves for Haiku's content blocks and gpt-6-luna's plain-string content alike.
export const ANSWER_PATH = "output.messages[-1].kwargs.content";

// Keeps Studio and prepare-step experiment copies away from online evaluators.
export const ONLINE_FILTER = 'and(eq(is_root, true), neq(metadata_key, "ls_experiment_id"))';

// Adding an assertions example from an annotation queue auto-creates a rule unless one with this
// exact display name already exists (smith-frontend ensureAssertionsRule.ts).
export const ASSERTIONS_RULE_NAME = "Assertions (auto-attached)";

// The built-in Assertions template (smith-frontend prebuilts/assertions.ts), in mustache form.
export const ASSERTIONS_PROMPT = `You are an expert data labeler evaluating whether a model output satisfies a set of explicit assertions. Your task is to evaluate each assertion independently and assign a score based on the following rubric:

<Rubric>
  An output passes an assertion if:
  - It clearly and verifiably satisfies the stated criterion based on the output content alone
  - Partial satisfaction does not count — an assertion is either met or not met
  - Stylistic differences are acceptable unless the assertion is about style

  An output fails an assertion if:
  - The criterion is not met
  - The criterion cannot be verified from the output (treat unverifiable as failed)
  - The output contradicts the criterion
</Rubric>

<Instructions>
  - The assertions are a list of entries. Each entry has a "key" field (a short slug used to identify the assertion in your response) and a "comment" field (the actual assertion the output must satisfy).
  - If the assertions list is missing or empty, set assertions_passed to FALSE and explain in the comment that the example does not contain assertions.
  - For each assertion, determine independently whether the output satisfies it. Do not let one failure influence judgment of another.
  - In your comment, list each assertion in the form "<key>: <comment>" followed by PASS or FAIL and a one-sentence justification grounded in the output text.
  - Set assertions_passed to TRUE only if every assertion passes.
</Instructions>

<Reminder>
  Evaluate against the assertions only. Do not penalize the output for content the assertions do not require, and do not reward content that is not asserted. Treat the assertions as a specification, not a model answer.
</Reminder>

<input>
{{inputs}}
</input>

<output>
{{outputs}}
</output>

<assertions>
{{assertions}}
</assertions>`;

export const ASSERTIONS_SCHEMA = {
  title: "Assertions_Score",
  type: "object",
  description:
    "An evaluation of whether the output satisfies every assertion specified in the reference output.",
  properties: {
    comment: {
      type: "string",
      description:
        'A per-assertion breakdown that: 1) Lists each assertion verbatim from the reference output, 2) Marks each as PASS or FAIL, 3) Provides a one-sentence justification grounded in the output text, and 4) Ends with "Thus, the score should be: TRUE/FALSE" based on whether every assertion passed.',
    },
    assertions_passed: {
      type: "boolean",
      description:
        "TRUE if and only if every assertion in the reference output is satisfied by the output. FALSE if any assertion fails, cannot be verified, or is contradicted by the output.",
    },
  },
  required: ["comment", "assertions_passed"],
  strict: true,
};

export const TONE_QUESTION =
  "Does the assistant's final answer read like professional technical documentation, with no emoji, no slang or hype, and product names written in full?";

export const TONE_LLM_RULE_NAME = "professional_tone_llm";

// Deliberately generic: the demo sharpens it in the Evaluator Playground against human labels.
export const TONE_LLM_PROMPT = `You are reviewing an answer from a documentation assistant for LangChain, LangGraph, LangSmith and Deep Agents.

Decide whether the answer's tone is professional: clear, courteous and suited to technical documentation that developers rely on.

<answer>
{{answer}}
</answer>`;

// The alignment queue needs exactly one boolean feedback key.
export const TONE_LLM_SCHEMA = {
  title: "Professional_Tone_Score",
  type: "object",
  description: "An evaluation of whether the answer's tone is professional.",
  properties: {
    comment: {
      type: "string",
      description: "Reasoning for the score, quoting any wording that breaks the tone.",
    },
    [TONE_LLM_RULE_NAME]: {
      type: "boolean",
      description: "TRUE if the answer's tone is professional. FALSE otherwise.",
    },
  },
  required: ["comment", TONE_LLM_RULE_NAME],
  strict: true,
};

// openevals TRAJECTORY_ACCURACY_PROMPT (LangSmith's "Trajectory Accuracy" template), in mustache form
// over the trajectory variable that trajectory rules receive.
export const TRAJECTORY_ACCURACY_PROMPT = `You are an expert data labeler.
Your task is to grade the accuracy of an AI agent's internal trajectory.

<Rubric>
  An accurate trajectory:
  - Makes logical sense between steps
  - Shows clear progression
  - Is relatively efficient, though it does not need to be perfectly efficient
</Rubric>

First, try to understand the goal of the trajectory by looking at the input
(if the input is not present try to infer it from the content of the first message),
as well as the output of the final message. Once you understand the goal, grade the trajectory
as it relates to achieving that goal.

Grade the following trajectory:

<trajectory>
{{trajectory}}
</trajectory>`;

export const TRAJECTORY_ACCURACY_SCHEMA = {
  title: "Trajectory_Accuracy_Score",
  type: "object",
  description:
    "An evaluation of whether the agent's internal trajectory was accurate and efficient.",
  properties: {
    comment: {
      type: "string",
      description:
        "A detailed analysis of whether the trajectory was logical, showed clear progression, and was reasonably efficient.",
    },
    trajectory_accuracy: {
      type: "boolean",
      description: "TRUE if the trajectory was accurate and efficient. FALSE otherwise.",
    },
  },
  required: ["comment", "trajectory_accuracy"],
  strict: true,
};

export interface JudgeModel {
  readonly id: string;
  readonly model: Record<string, unknown>;
}

export type RuleTarget =
  | { readonly kind: "dataset"; readonly datasetId: string }
  | { readonly kind: "session"; readonly sessionId: string };

export interface RuleBody {
  readonly display_name: string;
  readonly [key: string]: unknown;
}

function targetFields(target: RuleTarget) {
  return target.kind === "dataset"
    ? { dataset_id: target.datasetId }
    : { session_id: target.sessionId, filter: ONLINE_FILTER };
}

export function assertionsRule(datasetId: string, judge: JudgeModel): RuleBody {
  return {
    display_name: ASSERTIONS_RULE_NAME,
    dataset_id: datasetId,
    sampling_rate: 1,
    is_enabled: true,
    evaluators: [
      {
        structured: {
          model: judge.model,
          playground_settings_id: judge.id,
          prompt: [["human", ASSERTIONS_PROMPT]],
          schema: ASSERTIONS_SCHEMA,
          template_format: "mustache",
          variable_mapping: {
            inputs: "input.messages",
            outputs: ANSWER_PATH,
            assertions: "referenceOutput.assertions",
          },
        },
      },
    ],
  };
}

export function toneRule(datasetId: string, gatewaySecret = "LC_GATEWAY_KEY"): RuleBody {
  return {
    display_name: "professional_tone",
    dataset_id: datasetId,
    sampling_rate: 1,
    is_enabled: true,
    evaluators: [
      {
        structured: {
          model: {
            lc: 1,
            type: "constructor",
            id: ["langsmith", "playground", "TypeSafe"],
            kwargs: {
              model: "jev-latest",
              base_url: "https://gateway.smith.langchain.com/typesafe",
              // A plain string here is sent as the literal key and fails with a 401.
              typesafe_api_key: { lc: 1, type: "secret", id: [gatewaySecret] },
              questions: { professional_tone: { type: "noul", instructions: TONE_QUESTION } },
            },
          },
          prompt: [["human", "<answer>\n{{answer}}\n</answer>"]],
          template_format: "mustache",
          variable_mapping: { answer: ANSWER_PATH },
        },
      },
    ],
  };
}

// The Gateway's gpt-6-luna, serialized the way LangSmith's own model configs are.
function lunaModel(gatewaySecret = "LC_GATEWAY_KEY") {
  return {
    lc: 1,
    type: "constructor",
    id: ["langchain", "chat_models", "openai", "ChatOpenAI"],
    kwargs: {
      model: "gpt-6-luna",
      openai_api_base: "https://gateway.smith.langchain.com/openai/v1",
      openai_api_key: { lc: 1, type: "secret", id: [gatewaySecret] },
      use_responses_api: true,
    },
  };
}

/** An LLM twin of the Jev tone check, because Jev decision models can't use the alignment flow. */
export function toneLlmRule(datasetId: string, gatewaySecret = "LC_GATEWAY_KEY"): RuleBody {
  return {
    display_name: TONE_LLM_RULE_NAME,
    dataset_id: datasetId,
    sampling_rate: 1,
    is_enabled: true,
    create_alignment_queue: true,
    evaluators: [
      {
        structured: {
          model: lunaModel(gatewaySecret),
          prompt: [["human", TONE_LLM_PROMPT]],
          schema: TONE_LLM_SCHEMA,
          template_format: "mustache",
          variable_mapping: { answer: ANSWER_PATH },
        },
      },
    ],
  };
}

export function citesRule(datasetId: string, code: string): RuleBody {
  return {
    display_name: "cites_retrieved_docs",
    dataset_id: datasetId,
    sampling_rate: 1,
    is_enabled: true,
    code_evaluators: [{ code, language: "javascript" }],
  };
}

/** Online only: trajectory rules can't use datasets, code evaluators, few-shot or alignment. */
export function trajectoryRule(sessionId: string, judge: JudgeModel): RuleBody {
  return {
    display_name: "trajectory_accuracy",
    session_id: sessionId,
    filter: ONLINE_FILTER,
    group_by: "trajectory_id",
    sampling_rate: 1,
    is_enabled: true,
    evaluators: [
      {
        structured: {
          model: judge.model,
          playground_settings_id: judge.id,
          prompt: [["human", TRAJECTORY_ACCURACY_PROMPT]],
          schema: TRAJECTORY_ACCURACY_SCHEMA,
          template_format: "mustache",
          // The backend requires this exact mapping for trajectory rules.
          variable_mapping: { trajectory: "trajectory" },
        },
      },
    ],
  };
}

interface FeatureDefault {
  readonly feature: string;
  readonly default_model: string | null;
}

export async function resolveJudge(api: Api): Promise<JudgeModel> {
  const features = await api.get<FeatureDefault[]>("/platform/features");
  const id = features.find((entry) => entry.feature === "evaluators")?.default_model;
  if (!id)
    throw new Error("The workspace has no default evaluator model. Set one in LangSmith settings.");
  const config = await api.get<{ id: string; settings: Record<string, unknown> }>(
    `/playground-settings/${id}`,
  );
  return { id: config.id, model: config.settings };
}

export type EnsureResult = {
  readonly name: string;
  readonly id: string;
  readonly evaluatorId: string | null;
  readonly status: "created" | "exists";
};

interface RuleRecord {
  readonly id: string;
  readonly display_name: string;
  readonly evaluator_id?: string | null;
}

/**
 * Creates a rule only if its target has none with the same display name. Existing rules are left
 * alone, so alignment and few-shot settings made in the UI survive a re-run.
 */
export async function ensureRule(
  api: Api,
  target: RuleTarget,
  body: RuleBody,
): Promise<EnsureResult> {
  const query =
    target.kind === "dataset" ? { dataset_id: target.datasetId } : { session_id: target.sessionId };
  const existing = await api.get<RuleRecord[]>("/runs/rules", query);
  const match = existing.find((rule) => rule.display_name === body.display_name);
  const rule = match ?? (await api.post<RuleRecord>("/runs/rules", body));
  return {
    name: body.display_name,
    id: rule.id,
    evaluatorId: rule.evaluator_id ?? null,
    status: match ? "exists" : "created",
  };
}

/**
 * Attaches an evaluator that already exists instead of defining a new one, so every target shares
 * one prompt, alignment queue and reference dataset, and an edit reaches them all.
 */
export function sharedRule(
  target: RuleTarget,
  source: EnsureResult,
  { enabled = true }: { readonly enabled?: boolean } = {},
): RuleBody {
  if (!source.evaluatorId) throw new Error(`Rule ${source.name} has no evaluator to share.`);
  return {
    display_name: source.name,
    ...targetFields(target),
    sampling_rate: 1,
    is_enabled: enabled,
    evaluator_id: source.evaluatorId,
  };
}

/** The backend checks the shared evaluator is a trajectory one only when the rule groups by trajectory. */
export function sharedTrajectoryRule(sessionId: string, source: EnsureResult): RuleBody {
  return { ...sharedRule({ kind: "session", sessionId }, source), group_by: "trajectory_id" };
}
