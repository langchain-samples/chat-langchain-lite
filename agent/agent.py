from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig

from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.backends.context_hub import ContextHubBackend

from agent.tools import TOOLS
from context import CONTEXT_HUB_REPO, get_prompt

# AGENTS.md is the agent's system prompt — pulled fresh from LangSmith
# Context Hub at module import. The content lives in Context Hub, not in
# this repo. To change the prompt, edit it in the Context Hub UI.
SYSTEM_PROMPT = get_prompt()


def build_agent():
    return create_agent(
        model=ChatAnthropic(model="claude-haiku-4-5-20251001", max_tokens=2048),
        tools=TOOLS,
        system_prompt=SYSTEM_PROMPT,
        # FilesystemMiddleware exposes ls/read_file/etc. tools backed by the
        # same Context Hub repo, in case the agent needs to consult other
        # files (skills, policies, references) at request time.
        middleware=[
            FilesystemMiddleware(backend=ContextHubBackend(CONTEXT_HUB_REPO)),
        ],
    )


def _make_config(extra_metadata: dict = None) -> RunnableConfig:
    metadata = {"demo": "true", "demo_type": "chat-langchain-lite"}
    if extra_metadata:
        metadata.update(extra_metadata)
    return RunnableConfig(
        run_name="chat-langchain-lite-demo",
        metadata=metadata,
        tags=["engine-demo", "chat-langchain-lite-agent"],
    )


def invoke_agent(question: str, extra_metadata: dict = None, thread_id: str = None) -> dict:
    """Invoke the agent and return the full conversation as messages plus a flat tools_called list.

    The messages list (input, tool calls, tool results, final response) is stored
    in run.outputs so the trace shows the complete trajectory.
    tools_called is a flat list of tool names so evaluators can check it directly.
    """
    agent = build_agent()
    merged_metadata = {**(extra_metadata or {})}
    if thread_id:
        merged_metadata["thread_id"] = thread_id
    result = agent.invoke(
        {"messages": [{"role": "user", "content": question}]},
        _make_config(merged_metadata or None),
    )
    output = ""
    for msg in reversed(result["messages"]):
        if hasattr(msg, "content") and isinstance(msg.content, str) and msg.content:
            output = msg.content
            break
    tools_called = [msg.name for msg in result["messages"] if isinstance(msg, ToolMessage)]
    return {
        "output": output,
        "messages": result["messages"],
        "tools_called": tools_called,
    }


def stream_agent(question: str, extra_metadata: dict = None, thread_id: str = None):
    """Stream the agent response token by token. Yields str chunks."""
    result = invoke_agent(question, extra_metadata, thread_id=thread_id)
    yield from result["output"]
