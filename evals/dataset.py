"""LangSmith dataset management for the Chat LangChain Lite demo.

Examples use the same `assertions` format that Engine emits when it
proposes adding generated examples to a dataset — so Engine's suggestions
slot in alongside our seed examples and the same evaluator scores
everything uniformly.

Format:
    {
        "input":  {"question": "..."},
        "output": {
            "assertions": [
                {"key": "must_X", "comment": "human-readable success criterion"},
                ...
            ]
        },
        "metadata": {...}
    }

The seed dataset only contains POSITIVE examples (LangChain questions the
agent should handle well). The "decline off-topic" examples are intentionally
left out so that Engine's proposal to add them has visible impact when
evaluated in CI.
"""

from langsmith import Client
from langsmith.schemas import DataType

import os

# Presenter suffix — scopes every dataset/project/Context-Hub-repo name so
# multiple demoers in the same LangSmith workspace don't collide. Set via
# DEMO_PRESENTER env var (local `.env`) or GitHub repository variable
# (CI). Defaults to "robert" if not set.
DEMO_PRESENTER = os.getenv("DEMO_PRESENTER", "robert").strip() or "robert"

DATASET_NAME = f"chat-lc-lite-scope-{DEMO_PRESENTER}"
TOOL_ADHERENCE_DATASET_NAME = f"chat-lc-lite-tools-{DEMO_PRESENTER}"

EXAMPLES = [
    # All seed assertions are LOW-BAR — the buggy agent passes them. The
    # demo narrative is: "look, our existing test suite passes; but Engine
    # sees production behavior we never tested." Engine then proposes
    # adding stricter assertions / decline examples that expose the gaps.
    {
        "input": {"question": "How do I add LangSmith tracing to my LangChain app?"},
        "output": {
            "assertions": [
                {
                    "key": "must_address_the_tracing_question",
                    "comment": "Response addresses the user's question about LangSmith tracing.",
                },
                {
                    "key": "must_mention_setup_steps",
                    "comment": "Response mentions concrete setup steps such as environment variables or a tracing helper (any of: LANGSMITH_TRACING, LANGSMITH_API_KEY, @traceable, wrap_openai, etc.).",
                },
            ]
        },
        "metadata": {"category": "setup", "subcategory": "tracing"},
    },
    {
        "input": {"question": "What's the minimum Python version required by LangGraph?"},
        "output": {
            "assertions": [
                {
                    "key": "must_state_a_python_version",
                    "comment": "Response states a minimum Python version number for LangGraph (e.g. '3.7+', '3.8', '3.10+'). Any concrete number is acceptable for this assertion.",
                },
                {
                    "key": "must_address_the_question_directly",
                    "comment": "Response directly answers what minimum Python version is required, rather than punting or asking a clarifying question.",
                },
            ]
        },
        "metadata": {"category": "concept_info", "subcategory": "requirements"},
    },
    {
        "input": {"question": "Where can I find the official LangChain documentation?"},
        "output": {
            "assertions": [
                {
                    "key": "must_provide_a_documentation_url",
                    "comment": "Response provides at least one URL pointing to LangChain documentation. Any langchain.com subdomain counts (docs.langchain.com, python.langchain.com, js.langchain.com).",
                },
                {
                    "key": "must_mention_a_docs_source",
                    "comment": "Response mentions a documentation source the user can visit — any URL, site name, or reference to LangChain documentation is sufficient for this assertion.",
                },
            ]
        },
        "metadata": {"category": "concept_info", "subcategory": "documentation"},
    },
]


# Showcase examples for the secondary "tool adherence" dataset. Legacy
# {expected} format — these aren't scored by the assertions evaluator
# and aren't used by CI. They exist so the presenter has something to
# point at when explaining offline evals while the PR's CI is running.
TOOL_ADHERENCE_EXAMPLES = [
    {
        "input": {"question": "How long has LangSmith been around — what year was it first released?"},
        "output": {"expected": "LangSmith was first released in 2023."},
        "metadata": {"category": "concept_info", "subcategory": "history"},
    },
    {
        "input": {"question": "What package do I install to use LangGraph?"},
        "output": {"expected": "Install the `langgraph` package: `uv add langgraph` or `pip install -U langgraph`."},
        "metadata": {"category": "setup", "subcategory": "installation"},
    },
    {
        "input": {"question": "Tell me about Deep Agents — what is it?"},
        "output": {
            "expected": (
                "Deep Agents is LangChain's batteries-included agent harness. It wraps create_agent with "
                "a TodoList planner, virtual filesystem, and SubAgentMiddleware for context isolation. "
                "Inspired by Claude Code's harness pattern."
            )
        },
        "metadata": {"category": "concept_info", "subcategory": "overview"},
    },
]


def _create_or_update(
    name: str,
    examples: list[dict],
    description: str,
) -> str:
    """Idempotently create-or-update a dataset with the given examples."""
    ls_client = Client()
    datasets = list(ls_client.list_datasets(dataset_name=name))
    if datasets:
        dataset = datasets[0]
        print(f"Dataset '{name}' already exists (ID: {dataset.id}). Updating...")
        existing = list(ls_client.list_examples(dataset_id=dataset.id))
        if existing:
            ls_client.delete_examples([e.id for e in existing])
            print(f"  Cleared {len(existing)} existing examples.")
    else:
        dataset = ls_client.create_dataset(
            dataset_name=name,
            description=description,
            data_type=DataType.kv,
        )
        print(f"Created dataset '{name}' (ID: {dataset.id})")

    ls_client.create_examples(
        dataset_id=dataset.id,
        inputs=[e["input"] for e in examples],
        outputs=[e["output"] for e in examples],
        metadata=[e.get("metadata", {}) for e in examples],
    )
    print(f"Uploaded {len(examples)} examples to '{name}'.")
    return str(dataset.id)


def create_or_update_dataset() -> str:
    """Create or update the primary CI dataset (assertions format)."""
    return _create_or_update(
        DATASET_NAME,
        EXAMPLES,
        (
            "Chat LangChain Lite evaluation dataset. Examples use the "
            "{assertions: [{key, comment}]} format. Seed contains only "
            "positive cases — decline-type examples are added by Engine."
        ),
    )


def create_or_update_tool_adherence_dataset() -> str:
    """Create or update the secondary 'tool adherence' showcase dataset (legacy format)."""
    return _create_or_update(
        TOOL_ADHERENCE_DATASET_NAME,
        TOOL_ADHERENCE_EXAMPLES,
        (
            "Chat LangChain Lite — tool adherence showcase dataset. "
            "Legacy {expected} format. Not used by CI; kept for demo "
            "viewing alongside the primary assertions dataset."
        ),
    )


if __name__ == "__main__":
    create_or_update_dataset()
    create_or_update_tool_adherence_dataset()
