"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content, title }: { content: string; title?: string }) {
  // Strip duplicate title heading from content start (AI models often prepend it)
  let cleaned = content;
  if (title) {
    const trimmed = content.trimStart();
    for (const prefix of [`# ${title}`, `## ${title}`]) {
      if (trimmed.startsWith(prefix)) {
        cleaned = trimmed.slice(prefix.length).trimStart();
        break;
      }
    }
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-6 mb-2 text-text">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold mt-5 mb-2 text-text">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-4 mb-1.5 text-text">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="text-sm text-text leading-relaxed mb-3">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside text-sm text-text mb-3 space-y-1 pl-2">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside text-sm text-text mb-3 space-y-1 pl-2">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-sm text-text leading-relaxed">{children}</li>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="bg-code-inline-bg text-code-inline-text px-1.5 py-0.5 rounded text-xs font-mono break-all">
                {children}
              </code>
            );
          }
          return (
            <code
              className={`block bg-code-bg border border-border rounded-lg p-4 text-xs font-mono text-code-text overflow-x-auto mb-3 leading-relaxed whitespace-pre ${className}`}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="mb-3">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary pl-3 text-text-muted italic mb-3">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-text">{children}</strong>
        ),
        hr: () => <hr className="border-border my-4" />,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="text-sm border border-border w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-bg-input px-3 py-1.5 text-left text-xs font-medium text-text-muted">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-3 py-1.5 text-xs text-text">
            {children}
          </td>
        ),
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}
