import { createMiddleware, ToolMessage } from "langchain";

// The docs MCP's tools, as named after the `langchainDocs` server in tools/mcp.ts.
const DOCS_TOOL_PREFIX = "langchainDocs_";

// Some docs pages inline their components' compiled source ahead of the page text.
const DEFINITION = /^(Content: )?export const [A-Za-z_$][\w$]* = /gm;
const ARROW = /\s*=>\s*/y;
const PARAM = /[A-Za-z_$][\w$]*/y;
const ASYNC = /async\s+/y;

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

// JSX text can hold a lone apostrophe, so a quote with no closing quote on its line opens nothing.
function skipQuoted(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === text[start]) return i + 1;
    else if (ch === "\n") break;
  }
  return start + 1;
}

function skipTemplate(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "`") return i + 1;
    else if (ch === "$" && text[i + 1] === "{") {
      const end = matchClose(text, i + 1);
      if (end < 0) return -1;
      i = end - 1;
    }
  }
  return -1;
}

/** Index just past the bracket that closes the one at `open`, or -1 when it never closes. */
function matchClose(text: string, open: number): number {
  const stack: string[] = [];
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === "`") {
      i = skipTemplate(text, i);
      if (i < 0) return -1;
      continue;
    }
    if (ch in CLOSERS) stack.push(CLOSERS[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** Where an arrow-function or object value starting at `start` ends, or -1 for any other value. */
function valueEnd(text: string, start: number): number {
  if (text[start] === "{") return matchClose(text, start);
  ASYNC.lastIndex = start;
  let i = ASYNC.test(text) ? ASYNC.lastIndex : start;
  if (text[i] === "(") i = matchClose(text, i);
  else {
    PARAM.lastIndex = i;
    i = PARAM.test(text) ? PARAM.lastIndex : -1;
  }
  if (i < 0) return -1;
  ARROW.lastIndex = i;
  if (!ARROW.test(text) || text[ARROW.lastIndex] !== "{") return -1;
  return matchClose(text, ARROW.lastIndex);
}

/** Remove top-level `export const` component definitions, keeping the page text around them. */
export function stripComponentSource(text: string): string {
  let kept = "";
  let from = 0;
  for (const match of text.matchAll(DEFINITION)) {
    if (match.index < from) continue;
    let end = valueEnd(text, match.index + match[0].length);
    if (end < 0) continue;
    if (text[end] === ";") end++;
    kept += text.slice(from, match.index) + (match[1] ?? "");
    from = end;
  }
  return from === 0 ? text : kept + text.slice(from);
}

function stripContent(content: ToolMessage["content"]): ToolMessage["content"] {
  if (typeof content === "string") return stripComponentSource(content);
  return content.map((block) =>
    block.type === "text" && typeof block.text === "string"
      ? { ...block, text: stripComponentSource(block.text) }
      : block,
  ) as ToolMessage["content"];
}

// Runs inside Deep Agents' filesystem middleware, so results shrink before its large-result eviction.
export function docsResultFilterMiddleware() {
  return createMiddleware({
    name: "docsResultFilter",
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      if (!request.toolCall.name.startsWith(DOCS_TOOL_PREFIX) || !ToolMessage.isInstance(result))
        return result;
      result.content = stripContent(result.content);
      return result;
    },
  });
}
