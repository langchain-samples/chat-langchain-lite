import { CodeLite } from "@langchain/macaw-components/components/Code/CodeLite";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const CODE_LANGUAGES = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  typescript: "typescript",
  javascript: "typescript",
  py: "python",
  python: "python",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
} as const;

function languageOf(className: string | undefined) {
  const tag = /language-(\w+)/.exec(className ?? "")?.[1]?.toLowerCase();
  return (tag && CODE_LANGUAGES[tag as keyof typeof CODE_LANGUAGES]) || "plaintext";
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-link underline hover:text-link-hover"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <div className="my-space-2">{children}</div>,
  code: ({ className, children }) => {
    const text = typeof children === "string" ? children : "";
    const isBlock = /language-/.test(className ?? "") || text.includes("\n");
    if (!isBlock) {
      return (
        <code className="rounded-xs bg-surface-level-3 px-space-1 font-mono text-[0.9em]">
          {children}
        </code>
      );
    }
    return (
      <CodeLite
        value={text.replace(/\n$/, "")}
        language={languageOf(className)}
        variant="block"
        wrapLines
      />
    );
  },
  ul: ({ children }) => <ul className="my-space-2 list-disc pl-space-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-space-2 list-decimal pl-space-5">{children}</ol>,
  p: ({ children }) => <p className="my-space-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-space-2 mt-space-4 text-lg font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-space-2 mt-space-4 text-lg font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-space-1 mt-space-3 font-semibold">{children}</h4>,
  table: ({ children }) => (
    <div className="my-space-2 overflow-x-auto">
      <table className="border-collapse text-sm [&_td]:border [&_td]:border-subtle [&_td]:px-space-2 [&_th]:border [&_th]:border-subtle [&_th]:px-space-2">
        {children}
      </table>
    </div>
  ),
};

export const Markdown = memo(function Markdown({ text }: { readonly text: string }) {
  return (
    <div className="break-words text-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
