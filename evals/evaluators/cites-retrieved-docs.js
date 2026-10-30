// Hosted LangSmith code evaluator: the sandbox calls performEval and allows no imports, so every
// helper stays inside it.
// oxlint-disable-next-line no-unused-vars
function performEval(run, _example) {
  const DOCS_TOOL_PREFIX = "langchainDocs_";
  const DOCS_URL = /https?:\/\/docs\.langchain\.com(\/[^\s)\]>"'`]*)/g;
  const DOCS_PATH = /(?:^|[\s("'`])(\/(?:oss|langsmith|langgraph|deepagents)\/[^\s)\]>"'`]*)/g;

  const kind = (message) => (Array.isArray(message.id) ? message.id.at(-1) : message.type) ?? "";
  const field = (message, name) => message.kwargs?.[name] ?? message[name];
  const text = (content) =>
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => (typeof block === "string" ? block : (block.text ?? "")))
            .join("\n")
        : "";
  const normalize = (path) =>
    path
      .split("#")[0]
      .replace(/[.,;:!?]+$/, "")
      .replace(/\.mdx?$/, "")
      .replace(/\/+$/, "");
  const collect = (source, pattern) =>
    [...source.matchAll(pattern)].map((match) => normalize(match[1]));

  const messages = run.outputs?.messages ?? [];
  const toolMessages = messages.filter(
    (message) =>
      /tool/i.test(kind(message)) &&
      String(field(message, "name") ?? "").startsWith(DOCS_TOOL_PREFIX),
  );
  const answer = [...messages].reverse().find((message) => /ai/i.test(kind(message)));

  const retrievedText = toolMessages.map((message) => text(field(message, "content"))).join("\n");
  const retrieved = new Set([
    ...collect(retrievedText, DOCS_URL),
    ...collect(retrievedText, DOCS_PATH),
  ]);
  const cited = [...new Set(collect(text(answer ? field(answer, "content") : ""), DOCS_URL))];
  const searched = toolMessages.length > 0;
  const unsupported = cited.filter((path) => !retrieved.has(path));

  const citesScore = searched && cited.length > 0 && unsupported.length === 0 ? 1 : 0;
  const citesComment = !searched
    ? "no search"
    : cited.length === 0
      ? "no links"
      : unsupported.length > 0
        ? `link not in results: ${unsupported.join(", ")}`
        : `${cited.length} link(s), all from the search results`;

  return [
    {
      key: "searched_docs",
      score: searched ? 1 : 0,
      comment: `${toolMessages.length} docs tool call(s)`,
    },
    { key: "cites_retrieved_docs", score: citesScore, comment: citesComment },
  ];
}
