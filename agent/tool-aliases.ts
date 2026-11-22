import { createMiddleware } from "langchain";

import { mcp } from "./tools/mcp.js";

type Servers = Record<string, { readonly includeTools?: readonly string[] }>;

/** Maps each declared MCP tool's raw name to the `{server}_` name the connector registers. */
export function mcpToolAliases(servers: Servers = mcp.servers): Map<string, string> {
  return new Map(
    Object.entries(servers).flatMap(([server, { includeTools = [] }]) =>
      includeTools.map((name) => [name, `${server}_${name}`] as const),
    ),
  );
}

// Models sometimes call an MCP tool by its raw server name, which ToolNode rejects as unknown.
export function toolAliasMiddleware(aliases: Map<string, string> = mcpToolAliases()) {
  return createMiddleware({
    name: "toolAliases",
    wrapToolCall: (request, handler) => {
      const name = aliases.get(request.toolCall.name);
      if (request.tool || !name) return handler(request);
      return handler({ ...request, toolCall: { ...request.toolCall, name } });
    },
  });
}
