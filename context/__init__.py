"""Agent context — pulled from LangSmith Context Hub at runtime.

The agent's system prompt (AGENTS.md) lives in LangSmith Context Hub, NOT
in this repo. Engine should look here to find where the agent's context
comes from — but the actual prompt content is edited in the Context Hub
UI, not in the codebase.

The repo name is scoped per-presenter via LANGSMITH_PROJECT (see
evals.dataset.DEMO_PRESENTER for derivation).
"""

from langsmith import Client

from evals.dataset import DEMO_PRESENTER

CONTEXT_HUB_REPO = f"chat-lc-lite-agent-{DEMO_PRESENTER}"


def get_prompt() -> str:
    """Return the agent's system prompt, pulled from LangSmith Context Hub.

    Returns an empty string if the hub is unreachable or the repo hasn't
    been seeded yet — run `python -m scripts.setup` to initialize it.
    """
    try:
        return Client().pull_agent(CONTEXT_HUB_REPO).files["AGENTS.md"].content
    except Exception:
        return ""
